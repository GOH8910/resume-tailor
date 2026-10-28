import { writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Test helper: writes a stand-in `sudo` into `dir` (put it first on PATH). It prints the command line it got
 * to stderr, checks the shape `sudo -n -u <user> -- /usr/bin/timeout -k <s> <n>s <command...>`, then runs the
 * command directly with FAKE_SUDO_RUN_AS set to the user, so tests do not depend on a real sudo or on GNU
 * timeout being at /usr/bin/timeout. Like GNU timeout, it exits 127 when the command does not exist.
 * Exits 99 when the shape is wrong.
 */
export async function writeFakeSudo(dir: string): Promise<string> {
  const script = path.join(dir, "sudo");
  await writeFile(
    script,
    [
      "#!/bin/sh",
      'echo "sudo $*" >&2',
      '[ "$1" = "-n" ] && [ "$2" = "-u" ] && [ "$4" = "--" ] && [ "$5" = "/usr/bin/timeout" ] && [ "$6" = "-k" ] || exit 99',
      'FAKE_SUDO_RUN_AS="$3"',
      "export FAKE_SUDO_RUN_AS",
      "shift 8",
      'command -v "$1" >/dev/null || { echo "timeout: failed to run command \'$1\': No such file or directory" >&2; exit 127; }',
      'exec "$@"',
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  return script;
}
