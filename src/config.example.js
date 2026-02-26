window.supabaseConfig = {
    url: 'https://your-project-id.supabase.co',
    
    key: 'your-anon-key-here'
};

if (window.SUPPRESS_VERBOSE === undefined) window.SUPPRESS_VERBOSE = true;
if (window.DEBUG_SUPABASE === undefined) window.DEBUG_SUPABASE = false;
if (window.netlifyIdentity && !window.SUPPRESS_VERBOSE) console.log('Running on Netlify');
if (!window.SUPPRESS_VERBOSE) {
    console.log('Configuration loaded');
    console.log('URL set:', !window.supabaseConfig.url.includes('your-project'));
    console.log('Key set:', !window.supabaseConfig.key.includes('your-anon-key'));
}
