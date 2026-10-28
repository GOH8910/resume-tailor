// Next compiles this file for the Edge runtime too. The positive check lets the Edge build drop the Node-only import.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerNode } = await import("./instrumentation-node");
    await registerNode();
  }
}
