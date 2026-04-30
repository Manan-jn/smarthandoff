import { spawn } from 'node:child_process';

export interface ClaudeCliOptions {
  model: string;
  timeoutMs?: number;
}

export async function callClaudeCli(
  prompt: string,
  _schema: object,
  options: ClaudeCliOptions
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timeout = options.timeoutMs ?? 120_000;

    const proc = spawn('claude', [
      '--print',
      '--no-session-persistence',
      '--output-format', 'json',
      '--model', options.model,
      '--system-prompt', 'You are a JSON API. Respond with a single JSON object only. No prose, no markdown fences, no explanation. Raw JSON only.',
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
      reject(new Error(`claude CLI timed out after ${timeout / 1000}s`));
    }, timeout);

    proc.stdin.write(prompt, 'utf8');
    proc.stdin.end();

    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) return;

      if (code !== 0) {
        reject(new Error(`claude CLI exited with code ${code}: ${stderr.slice(0, 200)}`));
        return;
      }

      let outer: Record<string, unknown>;
      try {
        outer = JSON.parse(stdout.trim()) as Record<string, unknown>;
      } catch {
        reject(new Error(`claude CLI returned non-JSON output: ${stdout.slice(0, 200)}`));
        return;
      }

      if (outer.is_error) {
        reject(new Error(`claude CLI error: ${String(outer.result).slice(0, 200)}`));
        return;
      }

      // --json-schema puts structured result here
      if (outer.structured_output && typeof outer.structured_output === 'object') {
        resolve(outer.structured_output);
        return;
      }

      // Fall back to parsing the text result (may be JSON or markdown-wrapped JSON)
      const resultText = String(outer.result ?? '');
      try {
        resolve(JSON.parse(resultText));
        return;
      } catch { /* fall through to extraction */ }

      // Extract JSON from a markdown code block
      const jsonMatch = resultText.match(/```(?:json)?\s*([\s\S]*?)```/) ??
                        resultText.match(/(\{[\s\S]*\})/);
      if (jsonMatch?.[1]) {
        try {
          resolve(JSON.parse(jsonMatch[1].trim()));
          return;
        } catch { /* fall through */ }
      }

      reject(new Error(`claude output was not valid JSON: ${resultText.slice(0, 300)}`));
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to spawn claude CLI: ${err.message}`));
    });
  });
}
