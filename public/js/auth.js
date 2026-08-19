// Check if already authenticated
document.addEventListener('DOMContentLoaded', async () => {
    try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
            const data = await res.json();
            if (data.success && data.user) {
                window.location.href = '/dashboard.html';
            }
        }
    } catch (err) {
        // Not authenticated, stay on login page
    }
});

function switchAuthTab(type) {
    const loginForm = document.getElementById('login-form');
    const regForm = document.getElementById('register-form');
    const tabLogin = document.getElementById('tab-login');
    const tabReg = document.getElementById('tab-register');
    const alertBox = document.getElementById('auth-alert');

    alertBox.style.display = 'none';

    if (type === 'login') {
        loginForm.style.display = 'block';
        regForm.style.display = 'none';
        tabLogin.classList.add('active');
        tabReg.classList.remove('active');
    } else {
        loginForm.style.display = 'none';
        regForm.style.display = 'block';
        tabReg.classList.add('active');
        tabLogin.classList.remove('active');
    }
}

function showAlert(message, type = 'error') {
    const alertBox = document.getElementById('auth-alert');
    alertBox.className = `alert-message ${type === 'error' ? 'alert-error' : 'alert-success'}`;
    alertBox.innerHTML = message;
    alertBox.style.display = 'block';
}

async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const btn = document.getElementById('login-btn');

    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Authenticating...';

    try {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });

        const data = await res.json();

        if (data.success) {
            showAlert('Login successful! Redirecting...', 'success');
            setTimeout(() => {
                window.location.href = '/dashboard.html';
            }, 600);
        } else {
            showAlert(data.message || 'Login failed. Please check your credentials.');
        }
    } catch (err) {
        console.error('Login error:', err);
        showAlert('An unexpected server error occurred. Please try again.');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> Log In to Dashboard';
    }
}

async function handleRegister(e) {
    e.preventDefault();
    const name = document.getElementById('reg-name').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const password = document.getElementById('reg-password').value;
    const btn = document.getElementById('reg-btn');

    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Creating Account...';

    try {
        const res = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email, password })
        });

        const data = await res.json();

        if (data.success) {
            showAlert('Registration successful! Redirecting to Dashboard...', 'success');
            setTimeout(() => {
                window.location.href = '/dashboard.html';
            }, 600);
        } else {
            showAlert(data.message || 'Registration failed.');
        }
    } catch (err) {
        console.error('Register error:', err);
        showAlert('An unexpected server error occurred. Please try again.');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-user-plus"></i> Create Account';
    }
}
