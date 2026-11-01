// NON-PRODUCTION Windows Named Pipe identity smoke-test.
// No SD Core auth, no Unity player, no operating Center, no wallet permissions.
using System.Diagnostics;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Win32.SafeHandles;

internal static class Program
{
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetNamedPipeClientProcessId(SafePipeHandle pipe, out uint clientPid);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetNamedPipeClientSessionId(SafePipeHandle pipe, out uint clientSession);

    private static readonly HashSet<string> Consumed = new(StringComparer.Ordinal);
    private const int TimeoutSeconds = 12;
    private static int passed;

    private static string Digest(string file)
    {
        using var fs = File.OpenRead(file);
        return Convert.ToHexString(SHA256.HashData(fs));
    }

    private static async Task<int> Child(string[] args)
    {
        // Arguments are disposable CI-only fixtures. Sending secret game tokens
        // via command line or environment variables is FORBIDDEN in production.
        if (args.Length != 4) return 11;
        using var client = new NamedPipeClientStream(".", args[1], PipeDirection.InOut, PipeOptions.Asynchronous);
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(TimeoutSeconds));
        await client.ConnectAsync(cts.Token);
        using var reader = new StreamReader(client, Encoding.UTF8, false, 1024, leaveOpen: true);
        using var writer = new StreamWriter(client, new UTF8Encoding(false), 1024, leaveOpen: true) { AutoFlush = true };
        await writer.WriteLineAsync($"HELLO|{args[2]}|{args[3]}");
        var result = await reader.ReadLineAsync(cts.Token);
        if (result is null) return 12;
        Console.WriteLine(result);
        return 0;
    }

    private static async Task OneCase(
        string name, bool expectedAccept, string nonce, string command,
        bool fixtureAttested = true, bool fixtureRevoked = false,
        bool fixtureExpired = false, bool rejectImage = false)
    {
        string pipeName = "sd-miner-peer-qa-" + Guid.NewGuid().ToString("N");
        var options = PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly;
        // This OS-level flag requests same-user pipe access. It does not grant
        // a scoped game session or verify a different user account denial in CI.
        using var pipe = new NamedPipeServerStream(
            pipeName, PipeDirection.InOut, 1, PipeTransmissionMode.Byte, options);
        string exe = Environment.ProcessPath ?? throw new InvalidOperationException("NO_APPHOST");
        var psi = new ProcessStartInfo(exe)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };
        foreach (var a in new[] { "client", pipeName, nonce, command })
            psi.ArgumentList.Add(a);
        using var child = Process.Start(psi) ?? throw new InvalidOperationException("CLIENT_START_FAILED");
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(TimeoutSeconds));
        try
        {
            await pipe.WaitForConnectionAsync(cts.Token);
            if (!GetNamedPipeClientProcessId(pipe.SafePipeHandle, out uint osPid))
                throw new InvalidOperationException("WIN32_GET_CLIENT_PID_FAILED:" + Marshal.GetLastWin32Error());
            if (!GetNamedPipeClientSessionId(pipe.SafePipeHandle, out uint osSession))
                throw new InvalidOperationException("WIN32_GET_CLIENT_SESSION_FAILED:" + Marshal.GetLastWin32Error());
            // Bind the OS pipe HANDLE to the process we actually launched; do
            // not believe a pid provided inside any client payload.
            bool samePid = osPid == (uint)child.Id;
            bool sameSession = Process.GetCurrentProcess().SessionId == (int)osSession;
            string observedImage = Process.GetProcessById(checked((int)osPid)).MainModule?.FileName ?? "";
            string expectedImage = Path.GetFullPath(exe);
            bool sameImage = string.Equals(Path.GetFullPath(observedImage), expectedImage,
                StringComparison.OrdinalIgnoreCase);
            string approvedDigest = Digest(exe);
            if (rejectImage) approvedDigest = new string('0', 64);
            bool hashOk = sameImage && string.Equals(Digest(observedImage), approvedDigest,
                StringComparison.OrdinalIgnoreCase);
            using var reader = new StreamReader(pipe, Encoding.UTF8, false, 1024, leaveOpen: true);
            using var writer = new StreamWriter(pipe, new UTF8Encoding(false), 1024, leaveOpen: true) { AutoFlush = true };
            string received = await reader.ReadLineAsync(cts.Token) ?? throw new InvalidOperationException("NO_HELLO");
            string[] parts = received.Split('|');
            bool messageOk = parts.Length == 3 && parts[0] == "HELLO" &&
                parts[1] == nonce && parts[2] == command;
            // This is not server authentication: all fixture flags are under
            // this test runner's control. Real SD Core must attest the session.
            bool fresh = !Consumed.Contains(nonce);
            bool canRead = command is "PING" or "GET_STATUS";
            bool accept = samePid && sameSession && hashOk && messageOk && fresh &&
                fixtureAttested && !fixtureRevoked && !fixtureExpired && canRead;
            if (accept) Consumed.Add(nonce);
            string reply = accept ? "OK|MOCK_READ_ONLY|CORE_NOT_CONNECTED" : "DENIED";
            await writer.WriteLineAsync(reply);
            await child.WaitForExitAsync(cts.Token);
            string output = (await child.StandardOutput.ReadToEndAsync(cts.Token)).Trim();
            string error = (await child.StandardError.ReadToEndAsync(cts.Token)).Trim();
            if (child.ExitCode != 0 || accept != expectedAccept || output != reply)
                throw new InvalidOperationException(
                    name + " EXPECTED=" + expectedAccept + " GOT=" + accept +
                    " PID=" + samePid + " SESSION=" + sameSession + " HASH=" + hashOk +
                    " RESPONSE=" + output + " ERROR=" + error);
            Console.WriteLine("PASS " + name +
                (accept ? " (OS_PID_AND_IMAGE_BOUND; MOCK_SESSION_ONLY)" : " (DENIED)"));
            ++passed;
        }
        finally
        {
            if (!child.HasExited) child.Kill(entireProcessTree: true);
        }
    }

    private static async Task<int> Main(string[] args)
    {
        if (args.Length > 0 && args[0] == "client") return await Child(args);
        if (args.Length != 1 || args[0] != "test" || !OperatingSystem.IsWindows())
        {
            Console.Error.WriteLine("WINDOWS_DISPOSABLE_TEST_ONLY");
            return 2;
        }
        // Never use this as a server authorization source. It validates OS IPC
        // APIs and rejection/acceptance branches against local test fixtures.
        string nonce = Guid.NewGuid().ToString("N");
        await OneCase("OS_HANDLE_PID_SESSION_IMAGE_HASH", true, nonce, "PING");
        await OneCase("REPLAY_SAME_TICKET", false, nonce, "PING");
        await OneCase("NEW_TICKET_RECONNECT", true, Guid.NewGuid().ToString("N"), "PING");
        await OneCase("IMAGE_DIGEST_MISMATCH", false, Guid.NewGuid().ToString("N"), "PING", rejectImage: true);
        await OneCase("MISSING_SERVER_ATTESTATION", false, Guid.NewGuid().ToString("N"), "PING", fixtureAttested: false);
        await OneCase("SERVER_DEVICE_REVOKED_FIXTURE", false, Guid.NewGuid().ToString("N"), "PING", fixtureRevoked: true);
        await OneCase("SERVER_SESSION_EXPIRED_FIXTURE", false, Guid.NewGuid().ToString("N"), "PING", fixtureExpired: true);
        await OneCase("DENY_WALLET_WRITE", false, Guid.NewGuid().ToString("N"), "GRANT_COINS");
        await OneCase("DENY_WORLD_EVENT", false, Guid.NewGuid().ToString("N"), "SET_LOOT");
        await OneCase("READ_ONLY_STATUS", true, Guid.NewGuid().ToString("N"), "GET_STATUS");
        Console.WriteLine($"PASS WINDOWS_NATIVE_PEER_SMOKE {passed}/10; NO_UNITY_NO_CORE_NO_PRODUCTION");
        return 0;
    }
}
