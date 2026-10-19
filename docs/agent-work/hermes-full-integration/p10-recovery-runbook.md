# Isolated Friday recovery

Use a completed system backup whose verification reports `verified: true` and `wslIncluded: true`. Keep the backup on a separate volume with access restricted to the operator: it contains credentials and conversation history. Record its backup ID and snapshot time. The recovery target must be a **new** Friday installation of the same build, at a different Windows install root and in a different WSL distribution, with the **same Linux username**. Provision the pinned Hermes revision through the normal installer first. Do not configure an owner, connect accounts, add data or use the target Vault before recovery. The recovery guard refuses a nonempty application database and Vault; it does not overwrite another installation.

In an elevated PowerShell session, install the new target using the installer’s supported `-InstallRoot`, `-DistroName` and `-DistroLocation` parameters. The two Windows paths must be separate and on the same volume. Keep the old installation and old WSL distribution untouched. Then, from the **new target’s** installer directory, run:

```powershell
& .\scripts\recover-friday.ps1 -BackupPath 'X:\private-backups\<backup-id>' -TargetRoot 'X:\Friday-Recovery'
```

This prepares and verifies a private staging directory and returns `prepared-only`; it does not apply the backup. Review the reported Hermes revision and file count, and ensure the target is still the intended fresh installation. To perform the isolated cutover:

```powershell
& .\scripts\recover-friday.ps1 -BackupPath 'X:\private-backups\<backup-id>' -TargetRoot 'X:\Friday-Recovery' -Apply
```

The orchestrator stops only tasks owned by that target and its two Hermes services. It imports verified WSL user state, applies the Windows snapshot, re-runs the target installer’s bridge provisioning, then checks dashboard HTTP health, gateway activity, all four scoped bridge key matches and settings paths, plugin activation, the Messenger apply marker, and a read-only authenticated Memory search. `state: healthy` means those checks passed. The Memory probe returns no conversation contents to the console. Calendar and Mail provider reads, Messenger inbound/outbound delivery, voice hardware and cloud speech are **not** exercised by this automated recovery check; verify those separately with controlled nonproduction accounts/devices before switching traffic.

If recovery fails, keep the reported staging directory and any WSL receipt. The script attempts to roll back exact unchanged targets and restore prior scheduled-task and service states. It deliberately refuses rollback when a service or operator has changed recovered files after apply; investigate that state and reconcile any pending outboxes before another attempt. Never point this command at the old install root or live WSL distribution. A cloud voice key protected by another Windows user’s DPAPI cannot be imported; provision a new key for the recovery user before applying. Backups made before source-path metadata was added support inert verification, not this operational import.

The end-to-end physical clean-install recovery, provider reconnection, and traffic cutover are release gates. No RTO or RPO is claimed from fixture tests; measure both in the actual isolated recovery drill, including new-install provisioning and the interval since the backup snapshot.
