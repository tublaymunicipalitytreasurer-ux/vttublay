
async function checkExistingSession() {
    const isLoggedIn = sessionStorage.getItem('isLoggedIn') === 'true';
    if (isLoggedIn) {
        try {

            const { connected, session, error } = await checkConnection();
            if (connected && session) {
                window.location.href = 'system/dashboard.html';
            } else {

                sessionStorage.removeItem('isLoggedIn');
                sessionStorage.removeItem('userId');
            }
        } catch (err) {
            console.error('Session check error:', err);
            sessionStorage.removeItem('isLoggedIn');
            sessionStorage.removeItem('userId');
        }
    }
}


checkExistingSession();

document.addEventListener('DOMContentLoaded', function() {
    const loginForm = document.getElementById('loginForm');
    const emailInput = document.getElementById('username'); // Using email as username
    const passwordInput = document.getElementById('password');
    

    if (emailInput) {
        emailInput.focus();
    }
    

    if (loginForm) {
        loginForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const email = emailInput.value.trim();
            const password = passwordInput.value.trim();
            

            if (!email || !password) {
                showMessage('Please enter both email and password!', 'error');
                return;
            }
            

            const submitBtn = loginForm.querySelector('button[type="submit"]');
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.textContent = 'Logging in...';
            }
            
            try {

                showMessage('Connecting to server...', 'info');
                

                const supabaseReady = await waitForSupabase(15000);
                if (!supabaseReady) {
                    throw new Error('Server connection timeout. Please check your internet connection and try again.');
                }
                

                const result = await authLogin(email, password);
                
                if (result.success) {

                    sessionStorage.setItem('isLoggedIn', 'true');
                    sessionStorage.setItem('userId', result.user.id);
                    sessionStorage.setItem('userEmail', result.user.email);
                    

                    showMessage('Login successful! Redirecting...', 'success');
                    

                    setTimeout(() => {
                        window.location.href = 'system/dashboard.html';
                    }, 1000);
                } else {

                    showMessage(result.error || 'Invalid email or password!', 'error');
                    passwordInput.value = '';
                    passwordInput.focus();
                    

                    if (submitBtn) {
                        submitBtn.disabled = false;
                        submitBtn.textContent = 'Login';
                    }
                }
            } catch (error) {

                console.error('Login exception:', error);
                console.error('Error type:', error.constructor.name);
                console.error('Error message:', error.message);
                
                let errorMsg = `Error: ${error.message}`;
                
                if (error.name === 'ReferenceError') {
                    errorMsg = `Reference Error: ${error.message}`;
                } else if (error.name === 'TypeError') {
                    errorMsg = `Type Error: ${error.message}`;
                } else if (error.message?.includes('supabase')) {
                    errorMsg = `Connection Error: ${error.message}`;
                }
                
                showMessage(errorMsg, 'error');
                passwordInput.value = '';
                passwordInput.focus();
                

                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Login';
                }
            }
        });
    }
    

    function showMessage(message, type = 'error') {

        const existingMessage = document.querySelector('.error-message');
        if (existingMessage) {
            existingMessage.remove();
        }
        

        const messageDiv = document.createElement('div');
        messageDiv.className = `error-message ${type}`;
        messageDiv.textContent = message;
        

        const form = document.getElementById('loginForm');
        if (form) {
            form.insertBefore(messageDiv, form.firstChild);
            

            setTimeout(() => {
                messageDiv.classList.add('show');
            }, 10);
            

            const timeout = type === 'info' ? 5000 : 3000;
            setTimeout(() => {
                messageDiv.classList.remove('show');
                setTimeout(() => {
                    if (messageDiv.parentNode) {
                        messageDiv.parentNode.removeChild(messageDiv);
                    }
                }, 300);
            }, timeout);
        }
    }
    

    if (emailInput) {
        emailInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                passwordInput.focus();
            }
        });
    }
    
    if (passwordInput) {
        passwordInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                loginForm.dispatchEvent(new Event('submit'));
            }
        });
    }
});  