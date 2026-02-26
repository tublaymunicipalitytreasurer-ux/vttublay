
function getSupabaseClient() {
    return window.supabaseClient || (typeof supabase !== 'undefined' ? supabase : null);
}


function getUserId() {
    return sessionStorage.getItem('userId');
}


function mapViolationFromDB(item) {
    if (!item) return null;
    return {
        id: item.id,
        no: item.no,
        name: item.name,
        plateNumber: item.plate_number,
        date: item.date,
        section: item.section,
        section_id: item.section_id,
        offenses: item.offenses,
        offense_id: item.offense_id,
        level: item.level,
        fine: item.fine,
        status: item.status,
        officialReceiptNumber: item.official_receipt_number,
        datePaid: item.date_paid,
        userId: item.user_id,
        createdAt: item.created_at,
        updatedAt: item.updated_at
    };
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
            .select('*', { count: 'exact' })
            .eq('user_id', userId)
            .order('no', { ascending: true });

        if (error) {
            console.error('Fetch violations error:', error);
            throw error;
        }


        const mappedData = (data || []).map(mapViolationFromDB);

        return {
            success: true,
            data: mappedData,
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


        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(violation.section_id)) {
            throw new Error('Invalid section ID format');
        }
        if (!uuidRegex.test(violation.offense_id)) {
            throw new Error('Invalid offense ID format');
        }


        const violationData = {
            no: violation.no,
            name: violation.name,
            plate_number: violation.plateNumber,
            // If date is empty string, set to null for Postgres compatibility
            date: violation.date ? violation.date : null,
            section: violation.section,
            offenses: violation.offenses,
            section_id: violation.section_id,
            offense_id: violation.offense_id,
            level: violation.level,
            fine: violation.fine,
            status: violation.status || 'Unpaid',
            user_id: userId,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };


        if (violation.officialReceiptNumber) {
            violationData.official_receipt_number = violation.officialReceiptNumber;
        }
        if (violation.datePaid) {
            violationData.date_paid = violation.datePaid;
        }

        const { data, error } = await supabaseClient
            .from('violations')
            .insert([violationData])
            .select();

        if (error) {
            console.error('Add violation error:', error);
            throw error;
        }


        const mappedData = mapViolationFromDB(data?.[0]);

        return {
            success: true,
            data: mappedData,
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


        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(id)) {
            throw new Error('Invalid violation ID format');
        }
        if (!uuidRegex.test(violation.section_id)) {
            throw new Error('Invalid section ID format');
        }
        if (!uuidRegex.test(violation.offense_id)) {
            throw new Error('Invalid offense ID format');
        }

        const validation = validateViolation(violation);
        if (!validation.valid) {
            throw new Error(validation.error);
        }

        const violationData = {
            no: violation.no,
            name: violation.name,
            plate_number: violation.plateNumber,
            // If date is empty string, set to null for Postgres compatibility
            date: violation.date ? violation.date : null,
            section: violation.section,
            offenses: violation.offenses,
            section_id: violation.section_id,
            offense_id: violation.offense_id,
            level: violation.level,
            fine: violation.fine,
            status: violation.status,
            updated_at: new Date().toISOString()
        };


        if (violation.officialReceiptNumber) {
            violationData.official_receipt_number = violation.officialReceiptNumber;
        }
        if (violation.datePaid) {
            violationData.date_paid = violation.datePaid;
        }

        console.log('Updating violation:', { id, userId, violationData });

        const { data, error } = await supabaseClient
            .from('violations')
            .update(violationData)
            .eq('id', id)
            .eq('user_id', userId)
            .select();

        if (error) {
            console.error('Update violation error:', error);
            throw error;
        }

        if (!data || data.length === 0) {
            console.error('No data returned from update. Violation may not exist or user not authorized.');
            throw new Error('Violation not found or not authorized');
        }


        const mappedData = mapViolationFromDB(data[0]);

        return {
            success: true,
            data: mappedData,
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


        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(id)) {
            console.error('Invalid violation ID format:', id);
            throw new Error('Invalid violation ID format');
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


        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(id)) {
            console.error('Invalid violation ID format:', id);
            throw new Error('Invalid violation ID format');
        }


        if (!officialReceiptNumber || officialReceiptNumber.trim().length === 0) {
            throw new Error('Receipt number is required');
        }

        const validFormat = /^[A-Z0-9\-_]{3,50}$/i;
        if (!validFormat.test(officialReceiptNumber)) {
            throw new Error('Invalid receipt format. Use letters, numbers, hyphens, underscores (3-50 chars)');
        }

        const supabaseClient = getSupabaseClient();
        if (!supabaseClient) {
            throw new Error('Supabase not initialized');
        }


        const { data: checkData, error: checkError } = await supabaseClient
            .from('violations')
            .select('id, status')
            .eq('id', id)
            .eq('user_id', userId)
            .maybeSingle();

        if (checkError) {
            console.error('Error checking violation:', checkError);
            throw checkError;
        }

        if (!checkData) {
            console.error('Violation not found or not authorized:', { id, userId });
            throw new Error('Violation not found or not authorized');
        }


        const { data: existingReceipt, error: receiptCheckError } = await supabaseClient
            .from('violations')
            .select('id, no, name')
            .eq('user_id', userId)
            .eq('official_receipt_number', officialReceiptNumber)
            .neq('id', id)
            .maybeSingle();

        if (receiptCheckError && receiptCheckError.code !== 'PGRST116') {
            console.error('Error checking receipt:', receiptCheckError);
            throw receiptCheckError;
        }

        if (existingReceipt) {
            throw new Error(`Official Receipt Number ${officialReceiptNumber} is already used for violation #${existingReceipt.no}`);
        }


        const updateData = {
            status: 'Paid',
            official_receipt_number: officialReceiptNumber,
            date_paid: paymentDate || new Date().toISOString().split('T')[0],
            updated_at: new Date().toISOString()
        };

        console.log('Updating violation with data:', updateData);

        const { data, error } = await supabaseClient
            .from('violations')
            .update(updateData)
            .eq('id', id)
            .eq('user_id', userId)
            .select();

        if (error) {
            console.error('Mark as paid error:', error);
            throw error;
        }

        if (!data || data.length === 0) {
            console.error('No data returned after update');
            throw new Error('Violation not found or not authorized');
        }


        const mappedData = mapViolationFromDB(data[0]);

        return {
            success: true,
            data: mappedData,
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


        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(id)) {
            console.error('Invalid violation ID format:', id);
            throw new Error('Invalid violation ID format');
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


        const mappedData = mapViolationFromDB(data[0]);

        return {
            success: true,
            data: mappedData,
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


        const mappedData = (data || []).map(mapViolationFromDB);

        return {
            success: true,
            data: mappedData,
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


        const mappedData = (data || []).map(mapViolationFromDB);

        return {
            success: true,
            data: mappedData,
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
    if (!violation.section_id) {
        return { valid: false, error: 'Section ID is required' };
    }
    if (!violation.offense_id) {
        return { valid: false, error: 'Offense ID is required' };
    }

    return { valid: true, error: null };
}
