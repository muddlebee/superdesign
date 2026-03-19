import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as vscode from 'vscode';
import { ChildProcess, spawn } from 'child_process';
import { createInterface, Interface } from 'readline';
import { LLMMessage, LLMProvider, LLMProviderOptions, LLMStreamCallback } from './llmProvider';
import { Logger } from '../services/logger';

type PendingRequest = {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
};

type JsonRpcResponse = {
    id: number;
    result?: any;
    error?: {
        code: number;
        message: string;
    };
};

type JsonRpcNotification = {
    method: string;
    params?: any;
};

type ActiveTurnState = {
    turnId: string | null;
    messages: LLMMessage[];
    onMessage?: LLMStreamCallback;
    resolve: (messages: LLMMessage[]) => void;
    reject: (error: Error) => void;
    streamedAgentItemIds: Set<string>;
    startedToolItemIds: Set<string>;
};

export class CodexAppServerProvider extends LLMProvider {
    private workingDirectory = '';
    private workspaceRoot = '';
    private codexPath = 'codex';
    private child?: ChildProcess;
    private stdoutReader?: Interface;
    private stderrReader?: Interface;
    private nextRequestId = 1;
    private pendingRequests = new Map<number, PendingRequest>();
    private threadId: string | null = null;
    private activeTurn: ActiveTurnState | null = null;

    constructor(outputChannel: vscode.OutputChannel) {
        super(outputChannel);
        this.initializationPromise = this.initialize();
    }

    async initialize(): Promise<void> {
        if (this.isInitialized) {
            return;
        }

        try {
            Logger.info('Starting Codex app-server provider initialization...');
            await this.setupWorkingDirectory();
            await this.loadConfiguration();
            await this.checkCodexBinary();
            await this.checkCodexLogin();
            await this.startAppServer();
            this.isInitialized = true;
            Logger.info('Codex app-server provider initialized successfully');
        } catch (error) {
            Logger.error(`Failed to initialize Codex app-server provider: ${error}`);
            this.initializationPromise = null;
            this.isInitialized = false;
            throw error;
        }
    }

    private async setupWorkingDirectory(): Promise<void> {
        try {
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

            if (workspaceRoot) {
                this.workspaceRoot = workspaceRoot;
                const superdesignDir = path.join(workspaceRoot, '.superdesign');

                if (!fs.existsSync(superdesignDir)) {
                    fs.mkdirSync(superdesignDir, { recursive: true });
                    Logger.info(`Created .superdesign directory: ${superdesignDir}`);
                }

                this.workingDirectory = superdesignDir;
                return;
            }

            Logger.warn('No workspace root found, using temporary directory for Codex provider');
            const tempDir = path.join(os.tmpdir(), 'superdesign-codex');

            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }

            this.workspaceRoot = tempDir;
            this.workingDirectory = tempDir;
        } catch (error) {
            Logger.error(`Failed to setup Codex working directory: ${error}`);
            this.workspaceRoot = process.cwd();
            this.workingDirectory = process.cwd();
        }
    }

    private async loadConfiguration(): Promise<void> {
        const config = vscode.workspace.getConfiguration('superdesign');
        const configuredPath = config.get<string>('codexPath');
        if (configuredPath?.trim()) {
            this.codexPath = configuredPath.trim();
        }
    }

    private async checkCodexBinary(): Promise<void> {
        await this.runShortCommand(['--help'], 'Codex CLI help check');
    }

    private async checkCodexLogin(): Promise<void> {
        const output = await this.runShortCommand(['login', 'status'], 'Codex login status check');
        const normalized = `${output.stdout}\n${output.stderr}`.toLowerCase();

        if (!normalized.includes('logged in')) {
            throw new Error('Codex CLI is installed, but no login session was found. Please run `codex login`.');
        }
    }

    private async runShortCommand(args: string[], description: string): Promise<{ stdout: string; stderr: string }> {
        return new Promise((resolve, reject) => {
            const child = spawn(this.codexPath, args, {
                stdio: 'pipe',
                shell: false,
                env: { ...process.env }
            });

            let stdout = '';
            let stderr = '';

            child.stdout?.on('data', (data) => {
                stdout += data.toString();
            });

            child.stderr?.on('data', (data) => {
                stderr += data.toString();
            });

            child.on('error', (error) => {
                reject(error);
            });

            child.on('close', (code) => {
                if (code === 0) {
                    resolve({ stdout, stderr });
                    return;
                }

                reject(new Error(`${description} failed with exit code ${code}: ${stderr || stdout}`.trim()));
            });
        });
    }

    private async startAppServer(): Promise<void> {
        this.disposeAppServer();

        this.child = spawn(this.codexPath, ['app-server', '--listen', 'stdio://'], {
            cwd: this.workspaceRoot,
            stdio: 'pipe',
            shell: false,
            env: { ...process.env }
        });

        this.child.on('error', (error) => {
            Logger.error(`Codex app-server process error: ${error}`);
            this.failAllPending(error instanceof Error ? error : new Error(String(error)));
        });

        this.child.on('close', (code) => {
            Logger.warn(`Codex app-server process exited with code: ${code}`);
            this.isInitialized = false;
            this.threadId = null;
            this.failAllPending(new Error(`Codex app-server exited with code ${code}`));
        });

        this.stdoutReader = createInterface({ input: this.child.stdout! });
        this.stderrReader = createInterface({ input: this.child.stderr! });

        this.stdoutReader.on('line', (line) => {
            const trimmed = line.trim();
            if (trimmed) {
                this.handleServerMessage(trimmed);
            }
        });

        this.stderrReader.on('line', (line) => {
            const trimmed = line.trim();
            if (trimmed) {
                Logger.warn(`Codex app-server stderr: ${trimmed}`);
            }
        });

        const result = await this.sendRequest('initialize', {
            clientInfo: {
                name: 'superdesign',
                title: 'Superdesign',
                version: '0.0.14'
            },
            capabilities: {
                experimentalApi: true
            }
        });

        Logger.info(`Codex app-server initialized: ${JSON.stringify(result)}`);
        this.sendNotification('initialized', {});
    }

    private handleServerMessage(line: string): void {
        try {
            const message = JSON.parse(line) as JsonRpcResponse | JsonRpcNotification;

            if ('id' in message) {
                const pending = this.pendingRequests.get(message.id);
                if (!pending) {
                    return;
                }

                this.pendingRequests.delete(message.id);

                if (message.error) {
                    pending.reject(new Error(message.error.message));
                } else {
                    pending.resolve(message.result);
                }
                return;
            }

            this.handleNotification(message);
        } catch (error) {
            Logger.error(`Failed to parse Codex app-server message: ${error}\nLine: ${line}`);
        }
    }

    private handleNotification(notification: JsonRpcNotification): void {
        const params = notification.params;

        switch (notification.method) {
            case 'turn/started':
                if (this.activeTurn && params?.turn?.id) {
                    this.activeTurn.turnId = params.turn.id;
                }
                break;

            case 'item/agentMessage/delta':
                if (!this.matchesActiveTurn(params?.turnId)) {
                    return;
                }
                const activeTurn = this.activeTurn;
                if (!activeTurn) {
                    return;
                }
                activeTurn.streamedAgentItemIds.add(params.itemId);
                this.pushTurnMessage({
                    type: 'assistant',
                    role: 'assistant',
                    content: params.delta
                } as LLMMessage);
                break;

            case 'item/started':
                if (!this.matchesActiveTurn(params?.turnId)) {
                    return;
                }
                this.handleItemStarted(params.item);
                break;

            case 'item/completed':
                if (!this.matchesActiveTurn(params?.turnId)) {
                    return;
                }
                this.handleItemCompleted(params.item);
                break;

            case 'turn/completed':
                if (!this.activeTurn || (this.activeTurn.turnId && params?.turn?.id !== this.activeTurn.turnId)) {
                    return;
                }
                this.resolveActiveTurn();
                break;

            case 'error':
                if (this.activeTurn) {
                    const message = params?.message || 'Codex app-server error';
                    this.rejectActiveTurn(new Error(message));
                }
                break;

            default:
                break;
        }
    }

    private matchesActiveTurn(turnId?: string): boolean {
        if (!this.activeTurn) {
            return false;
        }

        if (!this.activeTurn.turnId && turnId) {
            this.activeTurn.turnId = turnId;
            return true;
        }

        return !this.activeTurn.turnId || this.activeTurn.turnId === turnId;
    }

    private handleItemStarted(item: any): void {
        if (!this.activeTurn || !item?.id || this.activeTurn.startedToolItemIds.has(item.id)) {
            return;
        }

        const toolCallMessage = this.toToolCallMessage(item);
        if (!toolCallMessage) {
            return;
        }

        this.activeTurn.startedToolItemIds.add(item.id);
        this.pushTurnMessage(toolCallMessage);
    }

    private handleItemCompleted(item: any): void {
        if (!this.activeTurn || !item) {
            return;
        }

        if (item.type === 'agentMessage') {
            if (!this.activeTurn.streamedAgentItemIds.has(item.id) && item.text) {
                this.pushTurnMessage({
                    type: 'assistant',
                    role: 'assistant',
                    content: item.text
                } as LLMMessage);
            }
            return;
        }

        const toolResultMessage = this.toToolResultMessage(item);
        if (toolResultMessage) {
            this.pushTurnMessage(toolResultMessage);
        }
    }

    private toToolCallMessage(item: any): LLMMessage | null {
        if (!item?.id) {
            return null;
        }

        switch (item.type) {
            case 'commandExecution':
                return {
                    type: 'tool-call',
                    role: 'assistant',
                    content: [{
                        type: 'tool-call',
                        toolCallId: item.id,
                        toolName: 'bash',
                        args: {
                            command: item.command,
                            cwd: item.cwd
                        }
                    }]
                } as unknown as LLMMessage;

            case 'mcpToolCall':
                return {
                    type: 'tool-call',
                    role: 'assistant',
                    content: [{
                        type: 'tool-call',
                        toolCallId: item.id,
                        toolName: `${item.server}:${item.tool}`,
                        args: item.arguments ?? {}
                    }]
                } as unknown as LLMMessage;

            case 'fileChange':
                return {
                    type: 'tool-call',
                    role: 'assistant',
                    content: [{
                        type: 'tool-call',
                        toolCallId: item.id,
                        toolName: 'fileChange',
                        args: {
                            changeCount: Array.isArray(item.changes) ? item.changes.length : 0
                        }
                    }]
                } as unknown as LLMMessage;

            default:
                return null;
        }
    }

    private toToolResultMessage(item: any): LLMMessage | null {
        if (!item?.id) {
            return null;
        }

        switch (item.type) {
            case 'commandExecution':
                return {
                    type: 'tool-result',
                    role: 'tool',
                    content: [{
                        type: 'tool-result',
                        toolCallId: item.id,
                        toolName: 'bash',
                        result: {
                            output: item.aggregatedOutput ?? '',
                            exitCode: item.exitCode,
                            status: item.status
                        },
                        isError: item.exitCode !== null && item.exitCode !== 0
                    }]
                } as unknown as LLMMessage;

            case 'mcpToolCall':
                return {
                    type: 'tool-result',
                    role: 'tool',
                    content: [{
                        type: 'tool-result',
                        toolCallId: item.id,
                        toolName: `${item.server}:${item.tool}`,
                        result: item.result ?? item.error ?? null,
                        isError: !!item.error
                    }]
                } as unknown as LLMMessage;

            case 'fileChange':
                return {
                    type: 'tool-result',
                    role: 'tool',
                    content: [{
                        type: 'tool-result',
                        toolCallId: item.id,
                        toolName: 'fileChange',
                        result: {
                            status: item.status,
                            changes: item.changes
                        },
                        isError: item.status !== 'applied'
                    }]
                } as unknown as LLMMessage;

            default:
                return null;
        }
    }

    private pushTurnMessage(message: LLMMessage): void {
        if (!this.activeTurn) {
            return;
        }

        this.activeTurn.messages.push(message);
        this.activeTurn.onMessage?.(message);
    }

    private async ensureThread(systemPrompt: string): Promise<void> {
        if (this.threadId) {
            return;
        }

        const response = await this.sendRequest('thread/start', {
            cwd: this.workspaceRoot,
            approvalPolicy: 'never',
            sandbox: 'workspace-write',
            developerInstructions: systemPrompt,
            serviceName: 'superdesign',
            experimentalRawEvents: false,
            persistExtendedHistory: false
        });

        this.threadId = response?.thread?.id ?? null;
        if (!this.threadId) {
            throw new Error('Codex app-server did not return a thread id');
        }
    }

    async query(
        prompt: string,
        options?: Partial<LLMProviderOptions>,
        abortController?: AbortController,
        onMessage?: LLMStreamCallback
    ): Promise<LLMMessage[]> {
        Logger.info('Starting Codex app-server query');

        await this.ensureInitialized();

        if (this.activeTurn) {
            throw new Error('Codex provider already has an active turn in progress');
        }

        const systemPrompt = options?.customSystemPrompt || 'You are Superdesign, a senior frontend designer integrated into VS Code.';
        await this.ensureThread(systemPrompt);

        return await new Promise<LLMMessage[]>(async (resolve, reject) => {
            this.activeTurn = {
                turnId: null,
                messages: [],
                onMessage,
                resolve,
                reject,
                streamedAgentItemIds: new Set<string>(),
                startedToolItemIds: new Set<string>()
            };

            try {
                const response = await this.sendRequest('turn/start', {
                    threadId: this.threadId,
                    input: [{
                        type: 'text',
                        text: prompt,
                        text_elements: []
                    }],
                    cwd: options?.cwd || this.workspaceRoot,
                    approvalPolicy: 'never'
                });

                this.activeTurn.turnId = response?.turn?.id ?? null;
                if (!this.activeTurn.turnId) {
                    throw new Error('Codex app-server did not return a turn id');
                }

                abortController?.signal.addEventListener('abort', () => {
                    if (!this.threadId || !this.activeTurn?.turnId) {
                        return;
                    }

                    this.sendRequest('turn/interrupt', {
                        threadId: this.threadId,
                        turnId: this.activeTurn.turnId
                    }).catch((error) => {
                        Logger.warn(`Failed to interrupt Codex turn: ${error}`);
                    });
                }, { once: true });
            } catch (error) {
                this.rejectActiveTurn(error instanceof Error ? error : new Error(String(error)));
            }
        });
    }

    private sendNotification(method: string, params?: any): void {
        if (!this.child?.stdin) {
            throw new Error('Codex app-server is not running');
        }

        this.child.stdin.write(`${JSON.stringify({
            jsonrpc: '2.0',
            method,
            params
        })}\n`);
    }

    private sendRequest(method: string, params?: any): Promise<any> {
        if (!this.child?.stdin) {
            throw new Error('Codex app-server is not running');
        }

        const id = this.nextRequestId++;

        return new Promise((resolve, reject) => {
            this.pendingRequests.set(id, { resolve, reject });
            this.child!.stdin!.write(`${JSON.stringify({
                jsonrpc: '2.0',
                id,
                method,
                params
            })}\n`);
        });
    }

    isReady(): boolean {
        return this.isInitialized && !!this.child && !this.child.killed;
    }

    async waitForInitialization(): Promise<boolean> {
        try {
            await this.ensureInitialized();
            return true;
        } catch (error) {
            Logger.error(`Codex app-server provider initialization failed: ${error}`);
            return false;
        }
    }

    getWorkingDirectory(): string {
        return this.workingDirectory;
    }

    hasValidConfiguration(): boolean {
        return true;
    }

    async refreshConfiguration(): Promise<boolean> {
        try {
            await this.loadConfiguration();
            await this.checkCodexBinary();
            await this.checkCodexLogin();

            if (!this.child || this.child.killed) {
                await this.startAppServer();
            }

            return true;
        } catch (error) {
            Logger.error(`Failed to refresh Codex configuration: ${error}`);
            return false;
        }
    }

    isAuthError(errorMessage: string): boolean {
        const lowerError = errorMessage.toLowerCase();
        return lowerError.includes('codex login') ||
            lowerError.includes('no login session') ||
            lowerError.includes('not installed') ||
            lowerError.includes('command not found') ||
            lowerError.includes('unauthorized');
    }

    getProviderName(): string {
        return 'Codex App Server';
    }

    getProviderType(): 'api' | 'binary' {
        return 'binary';
    }

    async resetSession(): Promise<void> {
        this.threadId = null;
    }

    private resolveActiveTurn(): void {
        if (!this.activeTurn) {
            return;
        }

        const activeTurn = this.activeTurn;
        this.activeTurn = null;
        activeTurn.resolve(activeTurn.messages);
    }

    private rejectActiveTurn(error: Error): void {
        if (!this.activeTurn) {
            return;
        }

        const activeTurn = this.activeTurn;
        this.activeTurn = null;
        activeTurn.reject(error);
    }

    private failAllPending(error: Error): void {
        for (const [id, pending] of this.pendingRequests.entries()) {
            pending.reject(error);
            this.pendingRequests.delete(id);
        }

        this.rejectActiveTurn(error);
    }

    private disposeAppServer(): void {
        this.stdoutReader?.close();
        this.stderrReader?.close();
        this.stdoutReader = undefined;
        this.stderrReader = undefined;

        if (this.child && !this.child.killed) {
            this.child.kill('SIGTERM');
        }

        this.child = undefined;
    }
}
