using System.Net.Security;
using System.Net.Sockets;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Channels;
using Api.Data;
using Api.Domain;
using Api.Hubs;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Api.Features.XmppBridge;

public sealed class XmppBridgeService : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IHubContext<ChatHub> _hub;
    private readonly IConfiguration _cfg;
    private readonly ILogger<XmppBridgeService> _log;

    // Outbound queue: app messages → MUC. Bounded so a disconnected bridge can't OOM.
    private readonly Channel<(string Sender, string Body)> _outbound =
        Channel.CreateBounded<(string, string)>(
            new BoundedChannelOptions(200) { FullMode = BoundedChannelFullMode.DropOldest });

    // Resolved once the bridge finds the configured room in the DB.
    private Guid? _bridgeRoomId;

    /// <summary>Room ID of the configured bridge target room, once resolved.</summary>
    public Guid? BridgeRoomId => _bridgeRoomId;

    /// <summary>Enqueue an app message for forwarding to the XMPP MUC.</summary>
    public bool TryEnqueueOutbound(string senderUsername, string body) =>
        _outbound.Writer.TryWrite((senderUsername, body));

    public XmppBridgeService(
        IServiceScopeFactory scopeFactory,
        IHubContext<ChatHub> hub,
        IConfiguration cfg,
        ILogger<XmppBridgeService> log)
    {
        _scopeFactory = scopeFactory;
        _hub = hub;
        _cfg = cfg;
        _log = log;
    }

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        if (_cfg.GetValue<bool>("Xmpp:Enabled") is false) return;

        // Give ejabberd time to finish startup and for the setup container to register accounts
        await Task.Delay(TimeSpan.FromSeconds(20), ct);

        while (!ct.IsCancellationRequested)
        {
            try
            {
                await RunSessionAsync(ct);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "XMPP bridge session ended, reconnecting in 15s");
                await Task.Delay(15_000, ct);
            }
        }
    }

    private async Task RunSessionAsync(CancellationToken ct)
    {
        var host = _cfg["Xmpp:Host"] ?? "ejabberd";
        var port = _cfg.GetValue<int?>("Xmpp:Port") ?? 5222;
        var domain = _cfg["Xmpp:Domain"] ?? "chat.local";
        var user = _cfg["Xmpp:BridgeUser"] ?? "bridge-bot";
        var pass = _cfg["Xmpp:BridgePassword"] ?? "Bridge123!";
        var mucJid = _cfg["Xmpp:MucJid"] ?? "bridge@conference.chat.local";

        using var tcp = new TcpClient();
        await tcp.ConnectAsync(host, port, ct);

        Stream stream = tcp.GetStream();
        var buf = new byte[65536];
        var accumulated = new StringBuilder();

        async Task Send(string xml)
        {
            var bytes = Encoding.UTF8.GetBytes(xml);
            await stream.WriteAsync(bytes, ct);
        }

        async Task<string> ReadUntil(string needle, int timeoutMs = 8000)
        {
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(timeoutMs);
            while (true)
            {
                var s = accumulated.ToString();
                var idx = s.IndexOf(needle, StringComparison.Ordinal);
                if (idx >= 0)
                {
                    var result = s[..(idx + needle.Length)];
                    accumulated.Remove(0, idx + needle.Length);
                    return result;
                }
                var n = await stream.ReadAsync(buf, cts.Token);
                if (n == 0) throw new EndOfStreamException("Connection closed");
                accumulated.Append(Encoding.UTF8.GetString(buf, 0, n));
            }
        }

        // --- 1. Open stream ---
        await Send($"<?xml version='1.0'?><stream:stream to='{domain}' xmlns='jabber:client' xmlns:stream='http://etherx.jabber.org/streams' version='1.0'>");
        var features = await ReadUntil("</stream:features>");

        // --- 2. STARTTLS if offered ---
        if (features.Contains("urn:ietf:params:xml:ns:xmpp-tls"))
        {
            await Send("<starttls xmlns='urn:ietf:params:xml:ns:xmpp-tls'/>");
            await ReadUntil("proceed");

            var ssl = new SslStream(stream, false, (_, _, _, _) => true);
            await ssl.AuthenticateAsClientAsync(host);
            stream = ssl;

            // Re-open stream over TLS
            await Send($"<?xml version='1.0'?><stream:stream to='{domain}' xmlns='jabber:client' xmlns:stream='http://etherx.jabber.org/streams' version='1.0'>");
            features = await ReadUntil("</stream:features>");
        }

        // --- 3. SASL PLAIN ---
        var authB64 = Convert.ToBase64String(Encoding.UTF8.GetBytes($"\0{user}\0{pass}"));
        await Send($"<auth xmlns='urn:ietf:params:xml:ns:xmpp-sasl' mechanism='PLAIN'>{authB64}</auth>");
        var authResp = await ReadUntil(">");
        if (!authResp.Contains("success"))
        {
            _log.LogError("XMPP auth failed: {resp}", authResp);
            return;
        }

        // --- 4. Re-open stream after auth ---
        await Send($"<?xml version='1.0'?><stream:stream to='{domain}' xmlns='jabber:client' xmlns:stream='http://etherx.jabber.org/streams' version='1.0'>");
        await ReadUntil("</stream:features>");

        // --- 5. Bind resource ---
        await Send("<iq type='set' id='b1'><bind xmlns='urn:ietf:params:xml:ns:xmpp-bind'><resource>bridge</resource></bind></iq>");
        await ReadUntil("</iq>");

        // --- 6. Presence + join MUC ---
        await Send("<presence xmlns='jabber:client'/>");
        await Send($"<presence to='{mucJid}/bridge-bot' xmlns='jabber:client'><x xmlns='http://jabber.org/protocol/muc'><history maxstanzas='0'/></x></presence>");

        _log.LogInformation("XMPP bridge joined {muc}", mucJid);

        // Eagerly resolve the bridge room ID so ChatHub can start forwarding immediately
        await ResolveBridgeRoomIdAsync(ct);

        // --- 7. Message loop ---
        while (!ct.IsCancellationRequested)
        {
            // Drain outbound queue → send to MUC
            while (_outbound.Reader.TryRead(out var outMsg))
            {
                var xml = $"<message to='{mucJid}' type='groupchat' xmlns='jabber:client'>" +
                          $"<body>[{outMsg.Sender}]: {outMsg.Body}</body></message>";
                await Send(xml);
            }

            // Check for complete <message> stanzas in inbound buffer
            while (true)
            {
                var text = accumulated.ToString();
                var end = text.IndexOf("</message>", StringComparison.Ordinal);
                if (end < 0) break;

                var start = text.LastIndexOf("<message", end, StringComparison.Ordinal);
                if (start < 0) { accumulated.Remove(0, end + 10); break; }

                var stanza = text[start..(end + 10)];
                accumulated.Remove(0, end + 10);
                await HandleMessageAsync(stanza, mucJid, ct);
            }

            // Read more data with a short timeout so outbound is checked frequently
            try
            {
                using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
                cts.CancelAfter(100);
                var n = await stream.ReadAsync(buf, cts.Token);
                if (n == 0) throw new EndOfStreamException();
                accumulated.Append(Encoding.UTF8.GetString(buf, 0, n));
            }
            catch (OperationCanceledException) when (!ct.IsCancellationRequested)
            {
                // read timeout — normal, keep looping
            }
        }
    }

    private async Task HandleMessageAsync(string stanza, string mucJid, CancellationToken ct)
    {
        // Only groupchat from our room
        if (!stanza.Contains("groupchat", StringComparison.Ordinal)) return;

        var roomPrefix = mucJid.Split('/')[0]; // bridge@conference.chat.local
        var fromPattern = new Regex(
            @"from=['""]" + Regex.Escape(roomPrefix) + @"/([^'""]+)['""]",
            RegexOptions.IgnoreCase);
        var fromMatch = fromPattern.Match(stanza);
        if (!fromMatch.Success) return;

        var nick = fromMatch.Groups[1].Value;
        if (nick == "bridge-bot") return; // skip our own echo

        var bodyMatch = Regex.Match(stanza, @"<body[^>]*>(.*?)</body>",
            RegexOptions.Singleline | RegexOptions.IgnoreCase);
        if (!bodyMatch.Success) return;

        var body = bodyMatch.Groups[1].Value.Trim();
        if (string.IsNullOrEmpty(body)) return;

        await ForwardToRoomAsync(nick, body, ct);
    }

    private async Task ResolveBridgeRoomIdAsync(CancellationToken ct)
    {
        if (_bridgeRoomId.HasValue) return;
        var roomName = _cfg["Xmpp:BridgeRoomName"] ?? "general";
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var room = await db.Rooms
            .FirstOrDefaultAsync(r => r.Name.ToLower() == roomName.ToLower(), ct);
        if (room is not null)
        {
            _bridgeRoomId = room.Id;
            _log.LogInformation("XMPP bridge target room resolved: {room} ({id})", room.Name, room.Id);
        }
    }

    private async Task ForwardToRoomAsync(string xmppNick, string body, CancellationToken ct)
    {
        var roomName = _cfg["Xmpp:BridgeRoomName"] ?? "general";
        var authorUsername = $"xmpp:{xmppNick}";

        try
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

            // Find target room by name (case-insensitive)
            var room = await db.Rooms
                .FirstOrDefaultAsync(r => r.Name.ToLower() == roomName.ToLower(), ct);
            if (room is null)
            {
                _log.LogDebug("Bridge target room '{name}' not found — skipping", roomName);
                return;
            }
            _bridgeRoomId ??= room.Id;

            // Get-or-create the per-sender system user
            var xmppUser = await db.Users
                .FirstOrDefaultAsync(u => u.UserName == authorUsername, ct);
            if (xmppUser is null)
            {
                xmppUser = new AppUser
                {
                    Id = Guid.NewGuid(),
                    UserName = authorUsername,
                    NormalizedUserName = authorUsername.ToUpperInvariant(),
                    SecurityStamp = Guid.NewGuid().ToString(),
                    PasswordHash = "*", // not loginable
                };
                db.Users.Add(xmppUser);
                await db.SaveChangesAsync(ct);
            }

            // Atomically advance the room watermark
            var watermark = await NextWatermarkAsync(db, room.Id, ct);

            var msg = new Message
            {
                Id = Guid.NewGuid(),
                RoomId = room.Id,
                AuthorId = xmppUser.Id,
                Content = body,
                SentAt = DateTime.UtcNow,
                Watermark = watermark,
            };
            db.Messages.Add(msg);
            await db.SaveChangesAsync(ct);

            // Broadcast to room group
            await _hub.Clients.Group($"room-{room.Id}").SendAsync("MessageReceived", new
            {
                id = msg.Id.ToString(),
                roomId = msg.RoomId.ToString(),
                authorId = xmppUser.Id.ToString(),
                authorUsername,
                content = body,
                sentAt = msg.SentAt,
                idempotencyKey = msg.Id.ToString(),
                watermark = msg.Watermark,
                editedAt = (DateTime?)null,
                deletedAt = (DateTime?)null,
                replyToMessageId = (string?)null,
                attachments = Array.Empty<object>(),
            }, ct);

            _log.LogInformation("Bridged message from {nick} → room '{room}'", xmppNick, roomName);
        }
        catch (Exception ex) when (!ct.IsCancellationRequested)
        {
            _log.LogError(ex, "Failed to forward XMPP message from {nick}", xmppNick);
        }
    }

    private static async Task<long> NextWatermarkAsync(AppDbContext db, Guid roomId, CancellationToken ct)
    {
        await db.Database.OpenConnectionAsync(ct);
        try
        {
            var conn = (NpgsqlConnection)db.Database.GetDbConnection();
            await using var cmd = conn.CreateCommand();
            cmd.CommandText =
                "UPDATE rooms SET current_watermark = current_watermark + 1 WHERE id = $1 RETURNING current_watermark";
            cmd.Parameters.AddWithValue(roomId);
            return Convert.ToInt64(await cmd.ExecuteScalarAsync(ct));
        }
        finally
        {
            await db.Database.CloseConnectionAsync();
        }
    }
}
