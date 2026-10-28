// Host install variables point at a real installation and its Obsidian vault; they must never leak into test runtimes.
const HOST_INSTALL_VARIABLES = ["FRIDAY_OBSIDIAN_VAULT", "FRIDAY_INSTALL_ROOT", "FRIDAY_CONFIG_DIR", "FRIDAY_STATE_ROOT"] as const;

for (const name of HOST_INSTALL_VARIABLES) delete process.env[name];

export {};

