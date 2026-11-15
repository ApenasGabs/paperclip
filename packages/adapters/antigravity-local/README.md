# Antigravity Local Adapter (`antigravity_local`)

Adaptador de execução do Google Antigravity CLI (`agy`) para o Paperclip, com suporte a streaming de eventos em tempo real (`stream-json`), balanceamento dinâmico em pool multi-contas e failover resiliente contra restrições de cota.

---

## 1. Visão Geral

O adaptador `antigravity_local` permite que o Paperclip orquestre sessões do agente Google Antigravity localmente ou via wrapper de pool de contas. Ele é projetado para:
- Executar runs de agentes de forma não-interativa (`--input-format stream-json --output-format stream-json`).
- Resumir conversas existentes com integridade de contexto (`--conversation <id>`).
- Capturar e estruturar deltas de texto, blocos de pensamento (`thinking`), telemetria de uso de tokens (`usage`) e status de conclusão.
- Detectar exaustão de quota upstream (`429`, `ResourceExhausted`, rate limits) e permitir failover inteligente.

---

## 2. Pool Multi-Contas & Failover Resiliente (`agy-wrapper.sh`)

Para ambientes homelab com múltiplas contas do Google Antigravity compartilhadas, o wrapper em `scripts/agy-wrapper.sh` atua como roteador transparente entre as credenciais disponíveis em `/paperclip/accounts`:

### Principais Mecanismos de Resiliência:
1. **Roteador em Cascata por Cota Real (`selectBestAccount`)**:
   - Consulta `agy /usage` de cada conta e persiste o resultado em `pool-state.json` (`accounts[id].liveQuota`) com TTL de 5 minutos, evitando uma chamada síncrona por conta a cada execução.
   - Respeita `AGY_ACCOUNT` (conta forçada) e a continuidade de conversa (`--resume`) quando o dono da conversa está livre e tem cota > 5% na família pedida.
   - Percorre a cadeia **Opus > Argon > Flash** (a família pedida via `--model` vai para o topo); em cada tier escolhe a conta com **maior cota restante** (> 5%), desempatando por menor concorrência, menor consumo em 5h e menos execuções.
   - Se todas as contas estiverem com cota crítica em todas as famílias, usa a conta com maior cota residual em `gemini-3.8-flash-high`.

2. **Slots Locais e Worker Remoto**:
   - `KRAKEN_MAX_LOCAL_SLOTS` (padrão `4`): execuções simultâneas no host local.
   - `KRAKEN_SLOT_WAIT_MAX_SEC` (padrão `600`): tempo máximo aguardando slot; ao estourar, o wrapper sai com código `4` listando os PIDs ocupados.
   - `KRAKEN_ENABLE_REMOTE=1`: habilita Wake-on-LAN e o worker remoto (`KRAKEN_COMPUTE_HOST`/`KRAKEN_COMPUTE_PORT`). Desligado por padrão.

3. **Ciclo de Failover em Falha de Cota**:
   - Quando uma conta atinge limite individual de tokens ou rate limit (`Resets in Xh Ym`), o wrapper registra o cooldown transitório (30 minutos por padrão ou tempo exato indicado pelo serviço).
   - O wrapper avança para a próxima conta do pool sem encerrar o processo com falha (`runWithFailover`), garantindo que o agente do Paperclip complete seu turno com sucesso.

---

## 3. Rotinas SRE & Kraken Watchtower

A rotina agendada diária `Auditoria Diária SRE & Validação de Logs (08:00 BRT)` (`e76be6e4-0d77-44c2-9ce6-972618b9cd0b`) é de responsabilidade do **Kraken Watchtower** (`1f898ec2-7916-4f2f-828e-f96b06a798b9`), o Lead SRE & Autonomous Log Auditor do Homelab.

### Configuração do Agente:
```json
{
  "command": "/paperclip/agy-wrapper.sh",
  "cwd": "/workspace",
  "model": "auto",
  "engine": "cli"
}
```

O script de reparo operacional e verificação está disponível em:
```bash
node scripts/repair-sre-routine-watchtower.mjs
```
