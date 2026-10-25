-- =====================================================================
-- Agenda a função "notificar" para rodar a cada 15 minutos.
-- Rode DEPOIS de publicar a função (README › "Avisos com o site fechado").
-- Troque COLE_AQUI_O_SEGREDO pelo mesmo valor do segredo NOTIFICAR_SEGREDO da função.
-- (Pode rodar de novo: ele troca o agendamento antigo.)
-- =====================================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobid) from cron.job where jobname = 'tb-notificar';

select cron.schedule('tb-notificar', '*/15 * * * *', $$
  select net.http_post(
    url     := 'https://lygqyliiebcxwxioxbvd.supabase.co/functions/v1/notificar',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-segredo', 'COLE_AQUI_O_SEGREDO'),
    body    := '{}'::jsonb,
    timeout_milliseconds := 20000)
$$);

-- conferir: select * from cron.job; e as últimas execuções: select * from cron.job_run_details order by start_time desc limit 5;
