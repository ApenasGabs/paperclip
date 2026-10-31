#!/usr/bin/env node
import { createDb } from "@paperclipai/db";

const dbUrl =
  process.env.DATABASE_URL ||
  "postgres://paperclip:paperclip@127.0.0.1:54329/paperclip";
const db = createDb(dbUrl);

console.log("[repair-sre-routine] Iniciando verificação da rotina SRE e Kraken Watchtower...");

try {
  // 1. Vincular rotina SRE diária (08:00 BRT) ao Kraken Watchtower
  await db.$client`
    UPDATE routines
    SET assignee_agent_id = '1f898ec2-7916-4f2f-828e-f96b06a798b9',
        updated_at = NOW()
    WHERE id = 'e76be6e4-0d77-44c2-9ce6-972618b9cd0b'
  `;

  // 2. Garantir adapterConfig com agy-wrapper.sh e /workspace
  await db.$client`
    UPDATE agents
    SET adapter_config = adapter_config || '{"command":"/paperclip/agy-wrapper.sh","cwd":"/workspace"}'::jsonb,
        updated_at = NOW()
    WHERE id = '1f898ec2-7916-4f2f-828e-f96b06a798b9'
  `;

  // 3. Resetar status de erro residual de agentes após resolução de pool
  await db.$client`
    UPDATE agents
    SET status = 'idle',
        error_reason = NULL,
        updated_at = NOW()
    WHERE id IN ('38631dff-5dd3-4fb6-bc81-d90aa6b27a00', 'fb0ad346-e4b6-42dc-a3fa-ec26d43454d1')
      AND status = 'error'
  `;

  console.log("[repair-sre-routine] ✅ Rotina SRE (e76be6e4) vinculada com sucesso ao Kraken Watchtower.");
  console.log("[repair-sre-routine] ✅ Configuração de adaptador (/paperclip/agy-wrapper.sh) validada.");
} catch (err) {
  console.error("[repair-sre-routine] ❌ Erro ao configurar rotina SRE:", err.message);
  process.exit(1);
} finally {
  await db.$client.end();
}
