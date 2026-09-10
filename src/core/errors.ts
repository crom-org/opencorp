export class OpencorpError extends Error {
  readonly exitCode: number;

  constructor(mensagem: string, opts: { exitCode?: number } = {}) {
    super(mensagem);
    this.name = this.constructor.name;
    this.exitCode = opts.exitCode ?? 1;
  }
}

export class WorkspaceError extends OpencorpError {}
export class AgentError extends OpencorpError {}
export class SessionError extends OpencorpError {}
export class RegistryError extends OpencorpError {}
export class TemplateError extends OpencorpError {}
export class SubcorpError extends OpencorpError {}
export class BudgetError extends OpencorpError {}
export class FlowError extends OpencorpError {}
export class MeetingError extends OpencorpError {}
export class TaskError extends OpencorpError {
  readonly status?: number;

  constructor(mensagem: string, opts: { exitCode?: number; status?: number } = {}) {
    super(mensagem, opts);
    this.status = opts.status;
  }
}
export class SchedulerError extends OpencorpError {}
export class HookError extends OpencorpError {}
export class ToolError extends OpencorpError {}
export class ComponentError extends OpencorpError {}
export class AppError extends OpencorpError {}
export class ApprovalError extends OpencorpError {}
export class TeamError extends OpencorpError {
  readonly status?: number;

  constructor(mensagem: string, opts: { exitCode?: number; status?: number } = {}) {
    super(mensagem, opts);
    this.status = opts.status;
  }
}
export class NotificationError extends OpencorpError {
  readonly status?: number;

  constructor(mensagem: string, opts: { exitCode?: number; status?: number } = {}) {
    super(mensagem, opts);
    this.status = opts.status;
  }
}
export class CanalError extends OpencorpError {
  readonly status?: number;

  constructor(mensagem: string, opts: { exitCode?: number; status?: number } = {}) {
    super(mensagem, opts);
    this.status = opts.status;
  }
}
