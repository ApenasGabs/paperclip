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
1. **Seleção Inteligente de Contas (`selectBestAccount`)**:
   - Avalia o cooldown de cada conta (`cooldownUntil`).
   - Prioriza contas saudáveis com cotas ativas para Argon, Gemini e Claude.
   - Caso todas as contas tenham registrado algum cooldown transitório, realiza fallback para todas as contas restantes no pool que ainda não foram tentadas na invocação atual, evitando aborto prematuro.
   - Ordena os candidatos por menor tempo restante de cooldown, menor concorrência ativa (`activeCount`), melhor pontuação de cota combinada e menor número de execuções.

2. **Cascata de Modelos (`resolveModelSequence`)**:
   - **Argon (Medium)**: ativado quando cota > 5%.
   - **Claude Sonnet 5.5 (Medium)**: priorizado como alternativa de alto raciocínio quando cota > 10%.
   - **Gemini 3.8 Flash (High)**: ativado como principal modelo resiliente de raciocínio.
   - **Gemini 3.8 Flash (Medium)**: fallback final de segurança.

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
