function getSupabaseClient() {
    if (window.supabaseClient) {
        return window.supabaseClient;
    }
    if (typeof supabase !== 'undefined' && supabase) {
        return supabase;
    }
    return null;
}


async function waitForSupabase(maxWaitMs = 15000) {
    const startTime = Date.now();
    console.log(`⏳ Waiting for Supabase... (max ${maxWaitMs}ms)`);
    
    while (Date.now() - startTime < maxWaitMs) {
        const client = getSupabaseClient();
        if (client && client.auth) {
            console.log('✅ Supabase ready!');
            return client;
        }
        await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    console.error('❌ Supabase initialization timed out after', maxWaitMs, 'ms');
    return null;
}


async function authLogin(email, password) {
    try {

        const supabaseClient = await waitForSupabase();
        

        if (!supabaseClient) {
            console.error('❌ Supabase not initialized - timeout waiting for library');
            return {
                success: false,
                user: null,
                error: 'Supabase is still initializing. Please wait a moment and try again.'
            };
        }

        if (!supabaseClient.auth) {
            console.error('❌ Supabase auth method not available');
            return {
                success: false,
                user: null,
                error: 'Supabase auth not available. Check console (F12) for errors.'
            };
        }

        if (!email || !password) {
            return {
                success: false,
                user: null,
                error: 'Email and password are required'
            };
        }


        if (!isValidEmail(email)) {
            return {
                success: false,
                user: null,
                error: 'Please enter a valid email address'
            };
        }


        if (password.length < 6) {
            return {
                success: false,
                user: null,
                error: 'Password must be at least 6 characters'
            };
        }


        const { data, error } = await supabaseClient.auth.signInWithPassword({
            email: email.toLowerCase().trim(),
            password: password
        });

        if (error) {
            console.error('Supabase login error:', error);
            return {
                success: false,
                user: null,
                error: error.message || 'Invalid email or password'
            };
        }

        if (!data.user) {
            return {
                success: false,
                user: null,
                error: 'Login failed. Please try again.'
            };
        }


        sessionStorage.setItem('isLoggedIn', 'true');
        sessionStorage.setItem('userId', data.user.id);
        sessionStorage.setItem('userEmail', data.user.email);
        sessionStorage.setItem('accessToken', data.session?.access_token || '');

        return {
            success: true,
            user: data.user,
            error: null
        };

    } catch (error) {
        console.error('Login exception:', error);
        return {
            success: false,
            user: null,
            error: 'An unexpected error occurred. Please try again.'
        };
    }
}


async function authLogout() {
    try {
        const supabaseClient = getSupabaseClient();
        if (!supabaseClient) {
            console.warn('Supabase not initialized, clearing local session');
            sessionStorage.removeItem('isLoggedIn');
            sessionStorage.removeItem('userId');
            sessionStorage.removeItem('userEmail');
            sessionStorage.removeItem('accessToken');
            return { success: true, error: null };
        }

        const { error } = await supabaseClient.auth.signOut();

        if (error) {
            console.error('Supabase logout error:', error);
            return {
                success: false,
                error: error.message
            };
        }


        sessionStorage.removeItem('isLoggedIn');
        sessionStorage.removeItem('userId');
        sessionStorage.removeItem('userEmail');
        sessionStorage.removeItem('accessToken');

        return {
            success: true,
            error: null
        };

    } catch (error) {
        console.error('Logout exception:', error);
        return {
            success: false,
            error: 'Logout failed'
        };
    }
}


async function isAuthenticated() {
    try {
        const supabaseClient = getSupabaseClient();
        if (!supabaseClient) return false;

        const { data: { session }, error } = await supabaseClient.auth.getSession();

        if (error) {
            console.error('Auth check error:', error);
            return false;
        }

        return !!session;

    } catch (error) {
        console.error('Auth check exception:', error);
        return false;
    }
}


async function getCurrentUserAuth() {
    try {
        const supabaseClient = getSupabaseClient();
        if (!supabaseClient) return null;

        const { data: { user }, error } = await supabaseClient.auth.getUser();

        if (error) {
            console.error('Get user error:', error);
            return null;
        }

        return user;

    } catch (error) {
        console.error('Get user exception:', error);
        return null;
    }
}


function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}


async function authSignUp(email, password) {
    try {
        if (!email || !password) {
            return {
                success: false,
                user: null,
                error: 'Email and password are required'
            };
        }

        if (!isValidEmail(email)) {
            return {
                success: false,
                user: null,
                error: 'Please enter a valid email address'
            };
        }

        if (password.length < 6) {
            return {
                success: false,
                user: null,
                error: 'Password must be at least 6 characters'
            };
        }

        const supabaseClient = getSupabaseClient();
        if (!supabaseClient) {
            return { success: false, user: null, error: 'Supabase not initialized' };
        }

        const { data, error } = await supabaseClient.auth.signUp({
            email: email.toLowerCase().trim(),
            password: password
        });

        if (error) {
            console.error('Supabase signup error:', error);
            return {
                success: false,
                user: null,
                error: error.message || 'Signup failed'
            };
        }

        return {
            success: true,
            user: data.user,
            error: null
        };

    } catch (error) {
        console.error('Signup exception:', error);
        return {
            success: false,
            user: null,
            error: 'An unexpected error occurred'
        };
    }
}


