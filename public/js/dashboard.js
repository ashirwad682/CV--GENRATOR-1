let allCVs = [];

document.addEventListener('DOMContentLoaded', async () => {
    await checkAuth();
    await loadUserCVs();
});

async function checkAuth() {
    try {
        const res = await fetch('/api/auth/me');
        if (!res.ok) {
            window.location.href = '/index.html';
            return;
        }

        const data = await res.json();
        if (data.success && data.user) {
            const name = data.user.name || 'User';
            document.getElementById('user-display-name').innerText = name;
            
            const initials = name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
            document.getElementById('user-avatar-initials').innerText = initials || 'U';
        } else {
            window.location.href = '/index.html';
        }
    } catch (err) {
        console.error('Auth verification error:', err);
        window.location.href = '/index.html';
    }
}

async function loadUserCVs() {
    try {
        const res = await fetch('/api/cvs');
        const data = await res.json();

        if (data.success) {
            allCVs = data.cvs || [];
            document.getElementById('total-cv-count').innerText = data.count || allCVs.length;
            renderCVGrid(allCVs);
        } else {
            alert(data.message || 'Failed to load CVs.');
        }
    } catch (err) {
        console.error('Error fetching CVs:', err);
    }
}

function renderCVGrid(cvs) {
    const grid = document.getElementById('cv-grid');
    grid.innerHTML = '';

    if (cvs.length === 0) {
        grid.innerHTML = `
            <div class="glass-panel empty-state">
                <div class="empty-icon"><i class="fa-solid fa-folder-open"></i></div>
                <h3 class="empty-title">No Resumes Found</h3>
                <p class="empty-desc">You haven't created any CVs yet. Click below to craft your first professional resume using the SpecialisedCV template.</p>
                <button class="btn-create" style="margin: 0 auto;" onclick="openCreateModal()">
                    <i class="fa-solid fa-plus"></i> Create Your First CV
                </button>
            </div>
        `;
        return;
    }

    cvs.forEach(cv => {
        const dateStr = new Date(cv.updatedAt || cv.createdAt).toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });

        const card = document.createElement('div');
        card.className = 'glass-panel cv-card';
        card.innerHTML = `
            <div>
                <div class="cv-card-header">
                    <div class="cv-card-icon">
                        <i class="fa-solid fa-file-lines"></i>
                    </div>
                </div>
                <h3 class="cv-card-title">${escapeHTML(cv.title)}</h3>
                <div class="cv-card-date">
                    <i class="fa-regular fa-clock"></i> Updated ${dateStr}
                </div>
            </div>

            <div class="cv-card-actions">
                <button class="btn-card-action btn-edit" onclick="editCV('${cv._id}')">
                    <i class="fa-solid fa-pen-to-square"></i> Edit
                </button>
                <button class="btn-card-action btn-preview" onclick="previewCV('${cv._id}')">
                    <i class="fa-solid fa-eye"></i> Preview
                </button>
                <button class="btn-card-action btn-download" onclick="downloadCVPDFDirect('${cv._id}', '${escapeHTML(cv.title)}')">
                    <i class="fa-solid fa-file-pdf"></i> PDF
                </button>
                <button class="btn-card-action btn-delete" onclick="deleteCV('${cv._id}', '${escapeHTML(cv.title)}')">
                    <i class="fa-solid fa-trash-can"></i> Delete
                </button>
            </div>
        `;
        grid.appendChild(card);
    });
}

function filterCVs() {
    const query = document.getElementById('search-input').value.toLowerCase().trim();
    if (!query) {
        renderCVGrid(allCVs);
        return;
    }
    const filtered = allCVs.filter(cv => cv.title.toLowerCase().includes(query));
    renderCVGrid(filtered);
}

function openCreateModal() {
    document.getElementById('create-modal').classList.add('active');
    document.getElementById('cv-title').focus();
}

function closeCreateModal() {
    document.getElementById('create-modal').classList.remove('active');
    document.getElementById('cv-title').value = '';
}

async function handleCreateCV(e) {
    e.preventDefault();
    const title = document.getElementById('cv-title').value.trim();
    const submitBtn = document.getElementById('create-submit-btn');

    if (!title) return;

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Creating...';

    try {
        const res = await fetch('/api/cvs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title })
        });

        const data = await res.json();

        if (data.success && data.cv) {
            closeCreateModal();
            // Redirect directly to SpecialisedCV editor template for this new CV
            window.location.href = `/SpecialisedCV.html?id=${data.cv._id}`;
        } else {
            alert(data.message || 'Error creating CV.');
        }
    } catch (err) {
        console.error('Create CV error:', err);
        alert('Server error creating CV.');
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fa-solid fa-check"></i> Create CV';
    }
}

function editCV(id) {
    window.location.href = `/SpecialisedCV.html?id=${id}`;
}

async function previewCV(id) {
    try {
        const res = await fetch('/api/cvs/' + id);
        const data = await res.json();

        if (data.success && data.cv) {
            const cv = data.cv;
            document.getElementById('preview-modal-title').innerText = `${cv.title} (Live Preview)`;
            const area = document.getElementById('preview-content-area');
            
            // Load exact SpecialisedCV template rendered in preview mode
            area.innerHTML = `<iframe src="/SpecialisedCV.html?id=${cv._id}&mode=preview" style="width:100%; height:75vh; border:none; border-radius:8px; background:#fff;"></iframe>`;

            document.getElementById('preview-download-pdf-btn').onclick = () => downloadCVPDFDirect(cv._id, cv.title);
            document.getElementById('preview-modal').classList.add('active');
        } else {
            alert(data.message || 'Unable to preview CV.');
        }
    } catch (err) {
        console.error('Preview error:', err);
    }
}

function closePreviewModal() {
    document.getElementById('preview-modal').classList.remove('active');
    document.getElementById('preview-content-area').innerHTML = '';
}

function downloadCVPDFDirect(id, title) {
    let iframe = document.getElementById('pdf-download-iframe');
    if (iframe) iframe.remove();

    iframe = document.createElement('iframe');
    iframe.id = 'pdf-download-iframe';
    iframe.style.position = 'fixed';
    iframe.style.left = '-10000px';
    iframe.style.top = '0';
    iframe.style.width = '210mm';
    iframe.style.height = '1200px';
    iframe.style.border = 'none';
    iframe.style.opacity = '0';
    iframe.style.pointerEvents = 'none';
    iframe.src = `/SpecialisedCV.html?id=${id}&download=pdf`;
    document.body.appendChild(iframe);

    setTimeout(() => {
        if (document.body.contains(iframe)) {
            document.body.removeChild(iframe);
        }
    }, 8000);
}

async function deleteCV(id, title) {
    if (!confirm(`Are you sure you want to delete "${title}"? This action cannot be undone.`)) {
        return;
    }

    try {
        const res = await fetch('/api/cvs/' + id, {
            method: 'DELETE'
        });

        const data = await res.json();

        if (data.success) {
            await loadUserCVs();
        } else {
            alert(data.message || 'Failed to delete CV.');
        }
    } catch (err) {
        console.error('Delete CV error:', err);
        alert('Server error deleting CV.');
    }
}

async function handleLogout() {
    try {
        await fetch('/api/auth/logout', { method: 'POST' });
        window.location.href = '/index.html';
    } catch (err) {
        window.location.href = '/index.html';
    }
}

function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g, 
        tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag] || tag)
    );
}
