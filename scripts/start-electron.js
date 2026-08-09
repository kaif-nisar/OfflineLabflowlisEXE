import { spawn } from "child_process";
import electronBinaryPath from "electron";

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronBinaryPath, ["."], {
    cwd: process.cwd(),
    stdio: "inherit",
    windowsHide: false,
    env,
});

child.on("exit", (code, signal) => {
    if (signal) {
        process.kill(process.pid, signal);
        return;
    }

    process.exit(code ?? 0);
});
