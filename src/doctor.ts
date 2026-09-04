import type { ResolvedConfig } from "./config.js";
import { getAbsoluteGitDirectory, getGitVersion } from "./git.js";
import { automaticWritesSupported } from "./platform.js";

export interface DoctorCheck {
  id: string;
  status: "pass" | "warning" | "fail";
  detail: string;
}

export interface DoctorReport {
  schemaVersion: "1.0";
  type: "doctor";
  toolVersion: string;
  rulePackVersion: string;
  status: "ok" | "warning" | "fail";
  repositoryRoot: string;
  runtime: {
    node: string;
    platform: NodeJS.Platform;
    architecture: string;
    git: string;
  };
  configuration: {
    source: ResolvedConfig["source"];
    path: string;
  };
  capabilities: {
    readOnlyAnalysis: boolean;
    automaticWrites: boolean;
  };
  checks: DoctorCheck[];
}

export function nodeRuntimeSupported(version: string): boolean {
  const [major = 0, minor = 0] = version.split(".").map((part) => Number.parseInt(part, 10));
  return major > 22 || (major === 22 && minor >= 14);
}

export function createDoctorReport(
  repositoryRoot: string,
  resolvedConfig: ResolvedConfig,
  toolVersion: string,
): DoctorReport {
  const nodeSupported = nodeRuntimeSupported(process.versions.node);
  const automaticWrites = automaticWritesSupported();
  const checks: DoctorCheck[] = [
    {
      id: "runtime.node",
      status: nodeSupported ? "pass" : "fail",
      detail: nodeSupported
        ? `Node ${process.versions.node} satisfies the >=22 runtime requirement.`
        : `Node ${process.versions.node} is unsupported; install Node 22 or newer.`,
    },
    {
      id: "repository.git",
      status: "pass",
      detail: `Git metadata: ${getAbsoluteGitDirectory(repositoryRoot)}`,
    },
    {
      id: "configuration",
      status: "pass",
      detail: `${resolvedConfig.source} configuration: ${resolvedConfig.path}`,
    },
    {
      id: "writes.platform",
      status: automaticWrites ? "pass" : "warning",
      detail: automaticWrites
        ? "Automatic writes are enabled for this POSIX runtime."
        : "Windows is read-only until DACL and no-clobber write semantics are independently verified.",
    },
  ];
  const status = checks.some((check) => check.status === "fail")
    ? "fail"
    : checks.some((check) => check.status === "warning")
      ? "warning"
      : "ok";
  return {
    schemaVersion: "1.0",
    type: "doctor",
    toolVersion,
    rulePackVersion: resolvedConfig.config.rulePackVersion,
    status,
    repositoryRoot,
    runtime: {
      node: process.versions.node,
      platform: process.platform,
      architecture: process.arch,
      git: getGitVersion(repositoryRoot),
    },
    configuration: {
      source: resolvedConfig.source,
      path: resolvedConfig.path,
    },
    capabilities: {
      readOnlyAnalysis: nodeSupported,
      automaticWrites: nodeSupported && automaticWrites,
    },
    checks,
  };
}

export function renderDoctor(
  report: DoctorReport,
  language: "en" | "zh" = "en",
): string {
  if (language === "zh") {
    const lines = [
      `RepoFit Comments 诊断：${report.status}`,
      `Node：${report.runtime.node}`,
      `Git：${report.runtime.git}`,
      `平台：${report.runtime.platform}/${report.runtime.architecture}`,
      `配置：${report.configuration.source}（${report.configuration.path}）`,
    ];
    for (const check of report.checks) {
      lines.push(`[${check.status}] ${check.id}：${check.detail}`);
    }
    return lines.join("\n");
  }
  const lines = [
    `RepoFit Comments doctor: ${report.status}`,
    `Node: ${report.runtime.node}`,
    `Git: ${report.runtime.git}`,
    `Platform: ${report.runtime.platform}/${report.runtime.architecture}`,
    `Config: ${report.configuration.source} (${report.configuration.path})`,
  ];
  for (const check of report.checks) {
    lines.push(`[${check.status}] ${check.id}: ${check.detail}`);
  }
  return lines.join("\n");
}
