// Windows .NET 8 probe for Node Center pipe CONTRACT, not a Unity game build.
// Single-use disposable MOCK ticket arrives over stdin; never command line.
// No SD Core money/inventory methods and no production login implementation.
using System.IO.Pipes;
using System.Text;
using System.Text.Json;

if (args.Length != 1 || !OperatingSystem.IsWindows())
{
    Console.Error.WriteLine("WINDOWS_TEST_ONLY");
    return 3;
}
string? ticket = await Console.In.ReadLineAsync();
if (ticket is null || ticket.Length != 64)
{
    Console.Error.WriteLine("INVALID_TEST_TICKET");
    return 4;
}
using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(8));
using var pipe = new NamedPipeClientStream(".", args[0], PipeDirection.InOut, PipeOptions.Asynchronous);
await pipe.ConnectAsync(cts.Token);
using var reader = new StreamReader(pipe, Encoding.UTF8, false, 1024, leaveOpen: true);
using var writer = new StreamWriter(pipe, new UTF8Encoding(false), 1024, leaveOpen: true) { AutoFlush = true };
await writer.WriteLineAsync(JsonSerializer.Serialize(new {
    type = "HELLO", version = 1, appId = "miner-unity", ticket
}));
var handshake = await reader.ReadLineAsync(cts.Token);
if (handshake is null) throw new InvalidOperationException("NO_HANDSHAKE");
using (var parsed = JsonDocument.Parse(handshake))
{
    var root = parsed.RootElement;
    if (!root.TryGetProperty("ok", out var ok) || !ok.GetBoolean())
    {
        Console.WriteLine("DENIED_AS_EXPECTED");
        return 2;
    }
    if (root.GetProperty("type").GetString() != "HELLO_ACK")
        throw new InvalidOperationException("INVALID_ACK");
}
await writer.WriteLineAsync("{\"type\":\"GET_STATUS\"}");
var status = await reader.ReadLineAsync(cts.Token);
if (status is null) throw new InvalidOperationException("NO_STATUS");
using (var parsed = JsonDocument.Parse(status))
{
    var root = parsed.RootElement;
    if (root.GetProperty("coreConnected").GetBoolean() ||
        root.GetProperty("runEngineConnected").GetBoolean())
        throw new InvalidOperationException("MUST_REMAIN_DISCONNECTED");
}
Console.WriteLine("C_SHARP_OS_PIPE_MOCK_SESSION_OK_NO_CORE");
return 0;
