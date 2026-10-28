# Job-Objekte fuer Prozessbaeume, die vollstaendig dem Installer gehoeren (pip, python, curl).
# Ein Job enthaelt nur Prozesse, die dieser Lauf selbst gestartet hat - fremde Prozesse und die
# WSL-Distribution bleiben unberuehrt. Beim Beenden des Jobs sterben auch Enkelprozesse, die ein
# abgebrochener pip-Lauf sonst als Waise weiterlaufen liesse.
$script:JobObjectSource = @'
using System;
using System.Runtime.InteropServices;

public static class FridayJobObject
{
    [StructLayout(LayoutKind.Sequential)]
    public struct IO_COUNTERS
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    private const int JobObjectExtendedLimitInformation = 9;
    private const uint JobObjectLimitKillOnJobClose = 0x2000;

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateJobObject(IntPtr attributes, string name);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint length);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool TerminateJobObject(IntPtr job, uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);

    public static IntPtr Create()
    {
        IntPtr job = CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero) { return IntPtr.Zero; }
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
        info.BasicLimitInformation.LimitFlags = JobObjectLimitKillOnJobClose;
        int size = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
        IntPtr buffer = Marshal.AllocHGlobal(size);
        try
        {
            Marshal.StructureToPtr(info, buffer, false);
            if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, buffer, (uint)size))
            {
                CloseHandle(job);
                return IntPtr.Zero;
            }
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
        return job;
    }

    public static bool Assign(IntPtr job, IntPtr process) { return AssignProcessToJobObject(job, process); }
    public static bool Terminate(IntPtr job) { return TerminateJobObject(job, 1); }
    public static void Close(IntPtr job) { if (job != IntPtr.Zero) { CloseHandle(job); } }
}
'@

function Initialize-JobObjectType {
    # Add-Type kompiliert einmal pro Lauf; danach ist der Typ im AppDomain vorhanden.
    if ('FridayJobObject' -as [type]) { return }
    Add-Type -TypeDefinition $script:JobObjectSource -Language CSharp -ErrorAction Stop
}

function New-ProcessJob {
    # Liefert ein Job-Handle oder 0, wenn Job-Objekte hier nicht verfuegbar sind. Der Aufrufer
    # arbeitet dann wie bisher weiter und beendet nur den gestarteten Prozess.
    try { Initialize-JobObjectType } catch { return [IntPtr]::Zero }
    try {
        $handle = [FridayJobObject]::Create()
        if ($handle -eq [IntPtr]::Zero) { return [IntPtr]::Zero }
        return $handle
    } catch { return [IntPtr]::Zero }
}

function Add-ProcessToJob([IntPtr]$Job, $Process) {
    if ($Job -eq [IntPtr]::Zero -or $null -eq $Process) { return $false }
    try { return [FridayJobObject]::Assign($Job, $Process.Handle) } catch { return $false }
}

function Stop-ProcessJob([IntPtr]$Job) {
    # Beendet alle Prozesse des Jobs. Das Handle bleibt offen, bis der Aufrufer es schliesst.
    if ($Job -eq [IntPtr]::Zero) { return $false }
    try { return [FridayJobObject]::Terminate($Job) } catch { return $false }
}

function Close-ProcessJob([IntPtr]$Job) {
    # Schliesst das Handle; mit KILL_ON_JOB_CLOSE sterben dann auch letzte Reste des Baums.
    if ($Job -eq [IntPtr]::Zero) { return }
    try { [FridayJobObject]::Close($Job) } catch { }
}