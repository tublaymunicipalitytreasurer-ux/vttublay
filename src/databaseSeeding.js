

async function seedViolationDatabase() {
    try {
        const supabaseClient = getSupabaseClient();
        if (!supabaseClient) {
            throw new Error('Supabase not initialized');
        }

        console.log('Starting database seeding...');


        const sections = await seedSections(supabaseClient);
        console.log(`Seeded ${sections.length} sections`);


        const offenses = await seedOffenses(supabaseClient, sections);
        console.log(`Seeded ${offenses.length} offenses`);


        const fines = await seedFines(supabaseClient, offenses);
        console.log(`Seeded ${fines.length} fines`);

        console.log('✅ Database seeding completed successfully');
        return { success: true };

    } catch (error) {
        console.error('Database seeding error:', error);
        return { success: false, error: error.message };
    }
}


async function seedSections(supabaseClient) {
    const sectionNames = [
        'Vehicle Registration (Section 63)',
        'Plate Numbers (Section 64)',
        'Upkeeps and Accessories (Section 65)',
        "Driver's License (Section 66)",
        'Sobriety and Courtesy (Section 67)',
        'Traffic Flow (Section 68)',
        'Speed Limit (Section 69)',
        'Seatbelt and Helmet (Section 70)',
        "Passenger's Safety (Section 71)"
    ];

    const sections = [];

    for (const sectionName of sectionNames) {
        const { data, error } = await supabaseClient
            .from('sections')
            .upsert({ section_name: sectionName }, { onConflict: 'section_name' })
            .select();

        if (error) {
            console.error(`Error upserting section ${sectionName}:`, error);
            continue;
        }

        if (data && data.length > 0) {
            sections.push(data[0]);
        }
    }

    return sections;
}


async function seedOffenses(supabaseClient, sections) {
    const offenses = [];


    const sectionMap = {};
    sections.forEach(section => {
        sectionMap[section.section_name] = section.id;
    });


    for (const [sectionName, offensesList] of Object.entries(violationsData)) {
        const sectionId = sectionMap[sectionName];
        if (!sectionId) {
            console.warn(`Section not found: ${sectionName}`);
            continue;
        }

        for (const offenseName of Object.keys(offensesList)) {
            const { data, error } = await supabaseClient
                .from('offenses')
                .upsert(
                    {
                        section_id: sectionId,
                        offense_name: offenseName
                    },
                    { onConflict: 'section_id,offense_name' }
                )
                .select();

            if (error) {
                console.error(`Error upserting offense ${offenseName}:`, error);
                continue;
            }

            if (data && data.length > 0) {
                offenses.push(data[0]);
            }
        }
    }

    return offenses;
}


async function seedFines(supabaseClient, offenses) {
    const fines = [];


    const offenseMap = {};
    offenses.forEach(offense => {
        offenseMap[offense.offense_name] = offense.id;
    });


    for (const [sectionName, offensesList] of Object.entries(violationsData)) {
        for (const [offenseName, fineAmounts] of Object.entries(offensesList)) {
            const offenseId = offenseMap[offenseName];
            if (!offenseId) {
                console.warn(`Offense not found: ${offenseName}`);
                continue;
            }


            for (let level = 1; level <= fineAmounts.length; level++) {
                const amount = fineAmounts[level - 1];

                const { data, error } = await supabaseClient
                    .from('fines')
                    .upsert(
                        {
                            offense_id: offenseId,
                            level: level,
                            amount: amount
                        },
                        { onConflict: 'offense_id,level' }
                    )
                    .select();

                if (error) {
                    console.error(`Error upserting fine for ${offenseName} level ${level}:`, error);
                    continue;
                }

                if (data && data.length > 0) {
                    fines.push(data[0]);
                }
            }
        }
    }

    return fines;
}


async function fetchSections() {
    try {
        const supabaseClient = getSupabaseClient();
        if (!supabaseClient) {
            throw new Error('Supabase not initialized');
        }

        const { data, error } = await supabaseClient
            .from('sections')
            .select('*')
            .order('section_name');

        if (error) throw error;

        return {
            success: true,
            data: data || [],
            error: null
        };

    } catch (error) {
        console.error('Fetch sections error:', error);
        return { success: false, data: [], error: error.message };
    }
}


async function fetchOffensesBySection(sectionId) {
    try {
        const supabaseClient = getSupabaseClient();
        if (!supabaseClient) {
            throw new Error('Supabase not initialized');
        }

        const { data, error } = await supabaseClient
            .from('offenses')
            .select('*')
            .eq('section_id', sectionId)
            .order('offense_name');

        if (error) throw error;

        return {
            success: true,
            data: data || [],
            error: null
        };

    } catch (error) {
        console.error('Fetch offenses error:', error);
        return { success: false, data: [], error: error.message };
    }
}


async function fetchFinesByOffense(offenseId) {
    try {
        const supabaseClient = getSupabaseClient();
        if (!supabaseClient) {
            throw new Error('Supabase not initialized');
        }

        const { data, error } = await supabaseClient
            .from('fines')
            .select('*')
            .eq('offense_id', offenseId)
            .order('level');

        if (error) throw error;

        return {
            success: true,
            data: data || [],
            error: null
        };

    } catch (error) {
        console.error('Fetch fines error:', error);
        return { success: false, data: [], error: error.message };
    }
}


async function getFineAmount(offenseId, level) {
    try {
        const supabaseClient = getSupabaseClient();
        if (!supabaseClient) {
            throw new Error('Supabase not initialized');
        }

        const { data, error } = await supabaseClient
            .from('fines')
            .select('amount')
            .eq('offense_id', offenseId)
            .eq('level', level)
            .single();

        if (error) throw error;

        return {
            success: true,
            amount: data?.amount || 0,
            error: null
        };

    } catch (error) {
        console.error('Get fine amount error:', error);
        return { success: false, amount: 0, error: error.message };
    }
}
