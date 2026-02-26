const DEBUG = !!window.DEBUG_SUPABASE;

function debugLog(...args) { if (DEBUG) console.log(...args); }
function debugWarn(...args) { if (DEBUG) console.warn(...args); }
function debugError(...args) { if (DEBUG) console.error(...args); }

if (!window.supabaseConfig) {
    debugError('CRITICAL: config.js not loaded');
    window.supabaseConfig = { url: 'https://your-project.supabase.co', key: 'your-anon-key' };
}

const SUPABASE_URL = window.supabaseConfig.url;
const SUPABASE_KEY = window.supabaseConfig.key;
let supabaseClient = null;

function getSupabaseLibrary() {
    if (window.supabase && typeof window.supabase.createClient === 'function') return window.supabase.createClient;
    if (typeof window.supabase === 'object' && window.supabase.createClient) return window.supabase.createClient;
    if (window.supabaseJs && typeof window.supabaseJs.createClient === 'function') return window.supabaseJs.createClient;
    return null;
}

async function initializeSupabaseClient() {
    let attempts = 0;
    const maxAttempts = 50;
    let delay = 100;
    while (attempts < maxAttempts) {
        attempts++;
        try {
            if (!window.supabaseLoaded) {
                await new Promise(resolve => setTimeout(resolve, delay));
                delay = Math.min(delay + 50, 500);
                continue;
            }
            const createClient = getSupabaseLibrary();
            if (!createClient) {
                await new Promise(resolve => setTimeout(resolve, delay));
                delay = Math.min(delay + 50, 500);
                continue;
            }
            supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY);
            if (!supabaseClient) throw new Error('createClient returned null');
            if (!supabaseClient.auth || !supabaseClient.from) throw new Error('Client methods missing');
            window.supabaseClient = supabaseClient;
            return true;
        } catch (error) {
            debugError(`Attempt ${attempts}: ${error.message}`);
            if (attempts >= maxAttempts) { window.supabaseClient = null; return false; }
            await new Promise(resolve => setTimeout(resolve, delay));
            delay = Math.min(delay + 50, 500);
        }
    }
    window.supabaseClient = null;
    return false;
}

initializeSupabaseClient();

async function checkConnection() {
    try {
        const client = window.supabaseClient;
        if (!client) throw new Error('Supabase client not initialized');
        const { data, error } = await client.auth.getSession();
        if (error) throw error;
        return { connected: true, session: data.session, error: null };
    } catch (error) {
        debugError('Supabase connection failed:', error);
        return { connected: false, session: null, error: error.message };
    }
}

async function getCurrentUser() {
    try {
        const client = window.supabaseClient;
        if (!client) throw new Error('Supabase client not initialized');
        const { data: { user }, error } = await client.auth.getUser();
        if (error) throw error;
        return { user, error: null };
    } catch (error) {
        return { user: null, error: error.message };
    }
}

async function getSession() {
    try {
        const client = window.supabaseClient;
        if (!client) throw new Error('Supabase client not initialized');
        const { data: { session }, error } = await client.auth.getSession();
        if (error) throw error;
        return { session, error: null };
    } catch (error) {
        return { session: null, error: error.message };
    }
}
