import { describe, expect, it } from "vitest";

import {
  BUILTIN_CAPABILITIES,
  CAPABILITIES_SCHEMA,
  validateCapabilityManifest,
} from "./capabilities";

describe("capability manifest", () => {
  it("validates the capabilities compiled into the current application", () => {
    expect(validateCapabilityManifest(BUILTIN_CAPABILITIES)).toEqual(BUILTIN_CAPABILITIES);
  });

  it("rejects duplicate operator ids", () => {
    expect(() =>
      validateCapabilityManifest({
        schema: CAPABILITIES_SCHEMA,
        applicationVersion: "test",
        protocolVersions: ["geometry-lab/embed@2"],
        operators: [
          {
            id: "curl.test",
            label: "First",
            kind: "measurement",
            backendBundle: "test",
            accepts: [],
            produces: ["field"],
          },
          {
            id: "curl.test",
            label: "Second",
            kind: "measurement",
            backendBundle: "test",
            accepts: [],
            produces: ["field"],
          },
        ],
      }),
    ).toThrow(/Duplicate/);
  });
});

