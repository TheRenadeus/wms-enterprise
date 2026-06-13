module.exports = {
  id: '013_cycle_count_blind',
  async run(pool) {
    await pool.query(`
      ALTER TABLE cycle_counts
        ADD COLUMN IF NOT EXISTS blind BOOLEAN DEFAULT false,
        ADD COLUMN IF NOT EXISTS location_filter VARCHAR(100) DEFAULT NULL;
    `);
  },
};
