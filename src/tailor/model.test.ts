import { describe, expect, it } from "vitest";
import { isModelId, modelName } from "./model";

describe("model names", () => {
  it("knows the models the picker offers", () => {
    expect(isModelId("claude-haiku-5-5")).toBe(true);
    expect(isModelId("claude-3-haiku")).toBe(false);
  });

  it("names a known model and shows an unknown id as is", () => {
    expect(modelName("claude-haiku-5-5")).toBe("Claude Haiku 5.5");
    expect(modelName("claude-next")).toBe("claude-next");
  });
});
