param(
    [Parameter(Mandatory)][int]$BrowserPid,
    [Parameter(Mandatory)][string]$Profile,
    [Parameter(Mandatory)][ValidateSet(9340,9341,9342,9343,9344,9345,9346,9347)][int]$Port,
    [Parameter(Mandatory)][string]$Binary
)
$ErrorActionPreference = 'Stop'
$owner = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $BrowserPid)
if (!$owner -or $owner.ExecutablePath -ne $Binary -or
    !$owner.CommandLine.Contains('--user-data-dir=' + $Profile) -or
    $owner.CommandLine -notmatch ('--remote-debugging-port=' + $Port + '(?:"|\s|$)')) {
    throw 'L1_WINDOW_OWNER_MISMATCH'
}
Add-Type -TypeDefinition @'
using System;using System.Text;using System.Runtime.InteropServices;
public class L1LoginWindow {
    public delegate bool Callback(IntPtr h, IntPtr x);
    [DllImport("user32.dll")] static extern bool EnumWindows(Callback callback, IntPtr x);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h,StringBuilder name,int length);
    [DllImport("user32.dll")] static extern bool ShowWindowAsync(IntPtr h, int command);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    public static bool Show(uint pid) {
        bool found = false;
        EnumWindows((h,x) => {
            uint owner;GetWindowThreadProcessId(h,out owner);
            if(owner != pid) return true;
            var name=new StringBuilder(128);GetClassName(h,name,name.Capacity);
            if(name.ToString() != "Chrome_WidgetWin_1")return true;
            ShowWindowAsync(h,9);SetForegroundWindow(h);found=true;return false;
        },IntPtr.Zero);
        return found;
    }
}
'@
if (![L1LoginWindow]::Show([uint32]$BrowserPid)) { throw 'L1_WINDOW_NOT_FOUND' }
