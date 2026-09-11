import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic } from "../../utils/fs-safe.js";
import { opencorpHome } from "../../utils/paths.js";
import { randomUUID } from "node:crypto";

export interface EngineAccountLimits {
  timeout_min: number;
  max_turns: number;
  rate_limit_rpm: number;
  daily_cost_usd: number;
  gasto_hoje_usd: number;
  status_cota: "normal" | "alerta_80" | "esgotado";
  fallback_action: "rotate" | "stop";
}

export interface EngineAccount {
  id: string;
  motorId: string;
  nome: string;
  authType: "token" | "apiKey" | "deviceOAuth";
  tokenOuChave?: string;
  ativa: boolean;
  criada_em: string;
  ultimo_uso?: string;
  limits: EngineAccountLimits;
}

export interface EngineLimitsConfig {
  timeout_min: number;
  max_turns: number;
  rate_limit_rpm: number;
  daily_cost_usd: number;
  status_cota: "normal" | "alerta_80" | "esgotado";
  fallback_action: "rotate" | "stop";
}

export const LIMITES_PADRAO_MOTORES: Record<string, EngineLimitsConfig> = {
  opencode: {
    timeout_min: 120,
    max_turns: 0, // 0 = ilimitado
    rate_limit_rpm: 120,
    daily_cost_usd: 100.0,
    status_cota: "normal",
    fallback_action: "rotate",
  },
  antigravity: {
    timeout_min: 120,
    max_turns: 0, // 0 = ilimitado
    rate_limit_rpm: 60,
    daily_cost_usd: 100.0,
    status_cota: "normal",
    fallback_action: "rotate",
  },
  copilot: {
    timeout_min: 120,
    max_turns: 0, // 0 = ilimitado
    rate_limit_rpm: 60,
    daily_cost_usd: 100.0,
    status_cota: "normal",
    fallback_action: "rotate",
  },
  "claude-code": {
    timeout_min: 120,
    max_turns: 0, // 0 = ilimitado
    rate_limit_rpm: 60,
    daily_cost_usd: 100.0,
    status_cota: "normal",
    fallback_action: "rotate",
  },
  cursor: {
    timeout_min: 120,
    max_turns: 0, // 0 = ilimitado
    rate_limit_rpm: 60,
    daily_cost_usd: 100.0,
    status_cota: "normal",
    fallback_action: "rotate",
  },
  "crom-agente": {
    timeout_min: 120,
    max_turns: 0, // 0 = ilimitado
    rate_limit_rpm: 120,
    daily_cost_usd: 100.0,
    status_cota: "normal",
    fallback_action: "rotate",
  },
};

export class EngineAccountStore {
  private readonly homeDir: string;
  private readonly filePath: string;
  private readonly runnerPath: string;

  constructor(opts: { homeDir?: string } = {}) {
    this.homeDir = opts.homeDir ?? opencorpHome();
    this.filePath = join(this.homeDir, ".opencorp", "engine-accounts.json");
    this.runnerPath = join(this.homeDir, ".opencorp", "runner.json");
  }

  private lerArquivoContas(): EngineAccount[] {
    if (!existsSync(this.filePath)) {
      return [];
    }
    try {
      const data = JSON.parse(readFileSync(this.filePath, "utf8"));
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  private async salvarArquivoContas(contas: EngineAccount[]): Promise<void> {
    await writeFileAtomic(this.filePath, `${JSON.stringify(contas, null, 2)}\n`);
  }

  public async listar(motorId?: string): Promise<EngineAccount[]> {
    const contas = this.lerArquivoContas();
    if (!motorId) return contas;
    return contas.filter((c) => c.motorId === motorId);
  }

  public async obter(contaId: string): Promise<EngineAccount | undefined> {
    const contas = this.lerArquivoContas();
    return contas.find((c) => c.id === contaId);
  }

  public async adicionarConta(
    motorId: string,
    dados: {
      nome: string;
      authType?: "token" | "apiKey" | "deviceOAuth";
      tokenOuChave?: string;
      limits?: Partial<EngineAccountLimits>;
    },
  ): Promise<EngineAccount> {
    const contas = this.lerArquivoContas();
    const padraoMotor = LIMITES_PADRAO_MOTORES[motorId] || {
      timeout_min: 120,
      max_turns: 0,
      rate_limit_rpm: 60,
      daily_cost_usd: 100.0,
      status_cota: "normal",
      fallback_action: "rotate",
    };

    const contasDoMotor = contas.filter((c) => c.motorId === motorId);
    const primeiraConta = contasDoMotor.length === 0;

    const novaConta: EngineAccount = {
      id: `${motorId}-${randomUUID().slice(0, 6)}`,
      motorId,
      nome: dados.nome.trim() || `Conta ${contasDoMotor.length + 1}`,
      authType: dados.authType || (dados.tokenOuChave ? "token" : "deviceOAuth"),
      tokenOuChave: dados.tokenOuChave?.trim() || undefined,
      ativa: primeiraConta,
      criada_em: new Date().toISOString(),
      limits: {
        timeout_min: dados.limits?.timeout_min ?? padraoMotor.timeout_min,
        max_turns: dados.limits?.max_turns ?? padraoMotor.max_turns,
        rate_limit_rpm: dados.limits?.rate_limit_rpm ?? padraoMotor.rate_limit_rpm,
        daily_cost_usd: dados.limits?.daily_cost_usd ?? padraoMotor.daily_cost_usd,
        gasto_hoje_usd: 0,
        status_cota: "normal",
        fallback_action: "rotate",
      },
    };

    contas.push(novaConta);
    await this.salvarArquivoContas(contas);
    await this.sincronizarAuth(motorId);
    return novaConta;
  }

  public async sincronizarAuth(motorOuProvedorId: string): Promise<void> {
    try {
      const ativa = await this.obterContaAtiva(motorOuProvedorId);
      const authPath = join(this.homeDir, ".opencorp", "opencode-data", "opencode", "auth.json");
      if (existsSync(authPath)) {
        const auth = JSON.parse(readFileSync(authPath, "utf8"));
        if (ativa?.tokenOuChave) {
          auth[motorOuProvedorId] = { type: "api", key: ativa.tokenOuChave };
          if (motorOuProvedorId === "opencode-go") {
            auth["opencode"] = { type: "api", key: ativa.tokenOuChave };
          }
        }
        await writeFileAtomic(authPath, `${JSON.stringify(auth, null, 2)}\n`);
      }
      const wsBase = join(this.homeDir, ".opencorp", "opencode-data", "workspaces");
      if (existsSync(wsBase)) {
        const dirs = readdirSync(wsBase, { withFileTypes: true });
        for (const d of dirs) {
          if (d.isDirectory()) {
            const wsAuthPath = join(wsBase, d.name, "opencode", "auth.json");
            if (existsSync(wsAuthPath)) {
              try {
                const wsAuth = JSON.parse(readFileSync(wsAuthPath, "utf8"));
                if (ativa?.tokenOuChave) {
                  wsAuth[motorOuProvedorId] = { type: "api", key: ativa.tokenOuChave };
                  if (motorOuProvedorId === "opencode-go") {
                    wsAuth["opencode"] = { type: "api", key: ativa.tokenOuChave };
                  }
                }
                await writeFileAtomic(wsAuthPath, `${JSON.stringify(wsAuth, null, 2)}\n`);
              } catch {}
            }
          }
        }
      }
    } catch {}
  }

  public async rotacionarProximaConta(motorId: string): Promise<EngineAccount | null> {
    const contas = this.lerArquivoContas().filter((c) => c.motorId === motorId);
    if (contas.length <= 1) return null;
    const idxAtiva = contas.findIndex((c) => c.ativa);
    const proxIdx = idxAtiva >= 0 ? (idxAtiva + 1) % contas.length : 0;
    const proxConta = contas[proxIdx]!;
    await this.ativarConta(motorId, proxConta.id);
    return proxConta;
  }

  public async ativarConta(motorId: string, contaId: string): Promise<void> {
    const contas = this.lerArquivoContas();
    let encontrou = false;
    for (const c of contas) {
      if (c.motorId === motorId) {
        c.ativa = c.id === contaId;
        if (c.ativa) encontrou = true;
      }
    }
    if (!encontrou) {
      throw new Error(`Conta "${contaId}" não encontrada para o motor "${motorId}".`);
    }
    await this.salvarArquivoContas(contas);
    await this.sincronizarAuth(motorId);
  }

  public async desconectarConta(motorId: string, contaId: string): Promise<void> {
    let contas = this.lerArquivoContas();
    const idx = contas.findIndex((c) => c.motorId === motorId && c.id === contaId);
    if (idx === -1) {
      throw new Error(`Conta "${contaId}" não encontrada para o motor "${motorId}".`);
    }
    const estavaAtiva = contas[idx]!.ativa;
    contas = contas.filter((c) => c.id !== contaId);

    if (estavaAtiva) {
      const proxima = contas.find((c) => c.motorId === motorId);
      if (proxima) proxima.ativa = true;
    }

    await this.salvarArquivoContas(contas);
    await this.sincronizarAuth(motorId);
  }

  public async atualizarLimitesConta(
    contaId: string,
    limites: Partial<EngineAccountLimits>,
  ): Promise<EngineAccount> {
    const contas = this.lerArquivoContas();
    const conta = contas.find((c) => c.id === contaId);
    if (!conta) {
      throw new Error(`Conta "${contaId}" não encontrada.`);
    }

    conta.limits = {
      ...conta.limits,
      ...limites,
    };

    await this.salvarArquivoContas(contas);
    return conta;
  }

  public async obterContaAtiva(motorId: string): Promise<EngineAccount | undefined> {
    const contas = this.lerArquivoContas();
    return contas.find((c) => c.motorId === motorId && c.ativa);
  }

  public async obterLimitesMotores(): Promise<Record<string, EngineLimitsConfig>> {
    let runnerLimits: Record<string, EngineLimitsConfig> = {};
    if (existsSync(this.runnerPath)) {
      try {
        const rJson = JSON.parse(readFileSync(this.runnerPath, "utf8"));
        if (rJson.limits && typeof rJson.limits === "object") {
          runnerLimits = rJson.limits;
        }
      } catch {}
    }

    const resultado: Record<string, EngineLimitsConfig> = {};
    for (const [id, padrao] of Object.entries(LIMITES_PADRAO_MOTORES)) {
      resultado[id] = {
        ...padrao,
        ...(runnerLimits[id] || {}),
      };
    }
    return resultado;
  }

  public async salvarLimitesMotores(limites: Record<string, Partial<EngineLimitsConfig>>): Promise<void> {
    let rJson: any = { engine: "opencode", timeout_min: 20 };
    if (existsSync(this.runnerPath)) {
      try {
        rJson = JSON.parse(readFileSync(this.runnerPath, "utf8"));
      } catch {}
    }

    rJson.limits = {
      ...(rJson.limits || {}),
      ...limites,
    };

    await writeFileAtomic(this.runnerPath, `${JSON.stringify(rJson, null, 2)}\n`);
  }

  public async obterAmbienteExecucao(motorId: string): Promise<Record<string, string>> {
    const conta = await this.obterContaAtiva(motorId);
    if (!conta || !conta.tokenOuChave) return {};

    const env: Record<string, string> = {};
    switch (motorId) {
      case "antigravity":
        env["GEMINI_API_KEY"] = conta.tokenOuChave;
        break;
      case "copilot":
        env["COPILOT_GITHUB_TOKEN"] = conta.tokenOuChave;
        env["GH_TOKEN"] = conta.tokenOuChave;
        break;
      case "claude-code":
        env["ANTHROPIC_API_KEY"] = conta.tokenOuChave;
        break;
      case "cursor":
        env["CURSOR_API_KEY"] = conta.tokenOuChave;
        break;
      case "crom-agente":
      case "opencode":
        env["OPENROUTER_API_KEY"] = conta.tokenOuChave;
        break;
    }
    return env;
  }
}
