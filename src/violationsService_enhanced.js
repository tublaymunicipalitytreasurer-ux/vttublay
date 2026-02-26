
function getSupabaseClient() {
    return window.supabaseClient || (typeof supabase !== 'undefined' ? supabase : null);
}


function getUserId() {
    return sessionStorage.getItem('userId');
}


async function fetchViolations() {
    try {
        const supabaseClient = getSupabaseClient();
        if (!supabaseClient) {
            throw new Error('Supabase not initialized');
        }

        const userId = getUserId();
        if (!userId) {
            throw new Error('User not authenticated');
        }


        const { data, error, count } = await supabaseClient
            .from('violations')
            .select(`
                *,
                sections(section_name),
                offenses(offense_name, section_id),
                fines(level, amount)
            `, { count: 'exact' })
            .eq('user_id', userId)
            .order('no', { ascending: true });

        if (error) {
            console.error('Fetch violations error:', error);
            throw error;
        }

        return {
            success: true,
            data: data || [],
            count: count || 0,
            error: null
        };

    } catch (error) {
        console.error('Fetch violations exception:', error);
        return {
            success: false,
            data: [],
            count: 0,
            error: error.message || 'Failed to fetch violations'
        };
    }
}


async function addViolation(violation) {
    try {
        const supabaseClient = getSupabaseClient();
        if (!supabaseClient) {
            throw new Error('Supabase not initialized');
        }

        const userId = getUserId();
        if (!userId) {
            throw new Error('User not authenticated');
        }


        const validation = validateViolation(violation);
        if (!validation.valid) {
            throw new Error(validation.error);
        }


        const violationData = {
            no: violation.no,
            name: violation.name,
            plate_number: violation.plateNumber,
            date: violation.date,

            section: violation.section,
            offenses: violation.offenses,
            level: violation.level,
            fine: violation.fine,

            section_id: violation.section_id || null,
            offense_id: violation.offense_id || null,
            fine_id: violation.fine_id || null,

            status: 'Unpaid',
            user_id: userId,
            created_at: new Date().toISOString()
        };

        const { data, error } = await supabaseClient
            .from('violations')
            .insert([violationData])
            .select();

        if (error) {
            console.error('Add violation error:', error);
            throw error;
        }

        return {
            success: true,
            data: data?.[0] || null,
            error: null
        };

    } catch (error) {
        console.error('Add violation exception:', error);
        return {
            success: false,
            data: null,
            error: error.message || 'Failed to add violation'
        };
    }
}


async function addViolationNormalized(violationData) {
    try {
        const supabaseClient = getSupabaseClient();
        if (!supabaseClient) {
            throw new Error('Supabase not initialized');
        }

        const userId = getUserId();
        if (!userId) {
            throw new Error('User not authenticated');
        }


        if (!violationData.section_id || !violationData.offense_id || !violationData.fine_id) {
            throw new Error('Section, Offense, and Fine IDs are required');
        }

        const insertData = {
            no: violationData.no,
            name: violationData.name,
            plate_number: violationData.plate_number,
            date: violationData.date,
            section_id: violationData.section_id,
            offense_id: violationData.offense_id,
            fine_id: violationData.fine_id,
            status: 'Unpaid',
            user_id: userId,
            created_at: new Date().toISOString()
        };

        const { data, error } = await supabaseClient
            .from('violations')
            .insert([insertData])
            .select();

        if (error) {
            console.error('Add violation normalized error:', error);
            throw error;
        }

        return {
            success: true,
            data: data?.[0] || null,
            error: null
        };

    } catch (error) {
        console.error('Add violation normalized exception:', error);
        return {
            success: false,
            data: null,
            error: error.message || 'Failed to add violation'
        };
    }
}


async function updateViolation(id, violation) {
    try {
        const userId = getUserId();
        if (!userId) {
            throw new Error('User not authenticated');
        }

        const supabaseClient = getSupabaseClient();
        if (!supabaseClient) {
            throw new Error('Supabase not initialized');
        }

        const validation = validateViolation(violation);
        if (!validation.valid) {
            throw new Error(validation.error);
        }

        const updateData = {
            no: violation.no,
            name: violation.name,
            plate_number: violation.plateNumber,
            // If date is empty string, set to null for Postgres compatibility
            date: violation.date ? violation.date : null,
            section: violation.section,
            offenses: violation.offenses,
            level: violation.level,
            fine: violation.fine,
            status: violation.status,
            section_id: violation.section_id || null,
            offense_id: violation.offense_id || null,
            fine_id: violation.fine_id || null,
            updated_at: new Date().toISOString()
        };

        const { data, error } = await supabaseClient
            .from('violations')
            .update(updateData)
            .eq('id', id)
            .eq('user_id', userId)
            .select();

        if (error) {
            console.error('Update violation error:', error);
            throw error;
        }

        if (!data || data.length === 0) {
            throw new Error('Violation not found or not authorized');
        }

        return {
            success: true,
            data: data[0],
            error: null
        };

    } catch (error) {
        console.error('Update violation exception:', error);
        return {
            success: false,
            data: null,
            error: error.message || 'Failed to update violation'
        };
    }
}


async function deleteViolation(id) {
    try {
        const supabaseClient = getSupabaseClient();
        if (!supabaseClient) {
            throw new Error('Supabase not initialized');
        }

        const userId = getUserId();
        if (!userId) {
            throw new Error('User not authenticated');
        }

        const { error } = await supabaseClient
            .from('violations')
            .delete()
            .eq('id', id)
            .eq('user_id', userId);

        if (error) {
            console.error('Delete violation error:', error);
            throw error;
        }

        return {
            success: true,
            error: null
        };

    } catch (error) {
        console.error('Delete violation exception:', error);
        return {
            success: false,
            error: error.message || 'Failed to delete violation'
        };
    }
}


async function markAsPaid(id, officialReceiptNumber, paymentDate) {
    try {
        const userId = getUserId();
        if (!userId) {
            throw new Error('User not authenticated');
        }

        if (!officialReceiptNumber || officialReceiptNumber.trim().length === 0) {
            throw new Error('Receipt number is required');
        }

        const validFormat = /^[A-Z0-9\-_]{3,50}$/i;
        if (!validFormat.test(officialReceiptNumber)) {
            throw new Error('Invalid receipt format');
        }

        const supabaseClient = getSupabaseClient();
        if (!supabaseClient) {
            throw new Error('Supabase not initialized');
        }

        const { data: existingReceipt, error: checkError } = await supabaseClient
            .from('violations')
            .select('id')
            .eq('user_id', userId)
            .eq('official_receipt_number', officialReceiptNumber)
            .neq('id', id)
            .single();

        if (checkError && checkError.code !== 'PGRST116') {
            throw checkError;
        }

        if (existingReceipt) {
            throw new Error('This Official Receipt Number is already used');
        }

        const { data, error } = await supabaseClient
            .from('violations')
            .update({
                status: 'Paid',
                official_receipt_number: officialReceiptNumber,
                date_paid: paymentDate,
                updated_at: new Date().toISOString()
            })
            .eq('id', id)
            .eq('user_id', userId)
            .select();

        if (error) {
            console.error('Mark as paid error:', error);
            throw error;
        }

        if (!data || data.length === 0) {
            throw new Error('Violation not found or not authorized');
        }

        return {
            success: true,
            data: data[0],
            error: null
        };

    } catch (error) {
        console.error('Mark as paid exception:', error);
        return {
            success: false,
            data: null,
            error: error.message || 'Failed to mark as paid'
        };
    }
}


async function undoPayment(id) {
    try {
        const supabaseClient = getSupabaseClient();
        if (!supabaseClient) {
            throw new Error('Supabase not initialized');
        }

        const userId = getUserId();
        if (!userId) {
            throw new Error('User not authenticated');
        }

        const { data, error } = await supabaseClient
            .from('violations')
            .update({
                status: 'Unpaid',
                official_receipt_number: null,
                date_paid: null,
                updated_at: new Date().toISOString()
            })
            .eq('id', id)
            .eq('user_id', userId)
            .select();

        if (error) {
            console.error('Undo payment error:', error);
            throw error;
        }

        if (!data || data.length === 0) {
            throw new Error('Violation not found or not authorized');
        }

        return {
            success: true,
            data: data[0],
            error: null
        };

    } catch (error) {
        console.error('Undo payment exception:', error);
        return {
            success: false,
            data: null,
            error: error.message || 'Failed to undo payment'
        };
    }
}


async function searchViolations(searchTerm) {
    try {
        const supabaseClient = getSupabaseClient();
        if (!supabaseClient) {
            throw new Error('Supabase not initialized');
        }

        const userId = getUserId();
        if (!userId) {
            throw new Error('User not authenticated');
        }

        const { data, error } = await supabaseClient
            .from('violations')
            .select('*')
            .eq('user_id', userId)
            .or(
                `name.ilike.%${searchTerm}%,plate_number.ilike.%${searchTerm}%,offenses.ilike.%${searchTerm}%,official_receipt_number.ilike.%${searchTerm}%`
            )
            .order('no', { ascending: true });

        if (error) {
            console.error('Search violations error:', error);
            throw error;
        }

        return {
            success: true,
            data: data || [],
            error: null
        };

    } catch (error) {
        console.error('Search violations exception:', error);
        return {
            success: false,
            data: [],
            error: error.message || 'Search failed'
        };
    }
}


async function filterViolations(filters) {
    try {
        const supabaseClient = getSupabaseClient();
        if (!supabaseClient) {
            throw new Error('Supabase not initialized');
        }

        const userId = getUserId();
        if (!userId) {
            throw new Error('User not authenticated');
        }

        let query = supabaseClient
            .from('violations')
            .select('*')
            .eq('user_id', userId);

        if (filters.status) {
            query = query.eq('status', filters.status);
        }
        if (filters.section) {
            query = query.eq('section', filters.section);
        }
        if (filters.section_id) {
            query = query.eq('section_id', filters.section_id);
        }
        if (filters.dateFrom) {
            query = query.gte('date', filters.dateFrom);
        }
        if (filters.dateTo) {
            query = query.lte('date', filters.dateTo);
        }

        const { data, error } = await query.order('no', { ascending: true });

        if (error) {
            console.error('Filter violations error:', error);
            throw error;
        }

        return {
            success: true,
            data: data || [],
            error: null
        };

    } catch (error) {
        console.error('Filter violations exception:', error);
        return {
            success: false,
            data: [],
            error: error.message || 'Filter failed'
        };
    }
}


function validateViolation(violation) {
    if (!violation.no || violation.no <= 0) {
        return { valid: false, error: 'Invalid violation number' };
    }
    if (!violation.name || violation.name.trim().length === 0) {
        return { valid: false, error: 'Name is required' };
    }
    if (!violation.plateNumber || violation.plateNumber.trim().length === 0) {
        return { valid: false, error: 'Plate number is required' };
    }
    if (!violation.section) {
        return { valid: false, error: 'Section is required' };
    }
    if (!violation.offenses) {
        return { valid: false, error: 'Offense is required' };
    }
    if (!violation.level || !['1', '2', '3'].includes(String(violation.level))) {
        return { valid: false, error: 'Valid offense level is required' };
    }
    if (violation.fine <= 0) {
        return { valid: false, error: 'Fine amount must be greater than 0' };
    }

    return { valid: true, error: null };
}


