/**
 * Små miljø-hjælpere uden afhængigheder, så publiceringslogikken kan testes
 * uden at hele Supabase-klienten skal med.
 */

/** Tørkørsel er standard. Man skal aktivt sætte "false" for at gå live. */
export const tørkørsel = () => process.env.PUBLISH_DRY_RUN !== 'false'
