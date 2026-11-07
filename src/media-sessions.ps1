param([switch]$Once, [switch]$Diagnostics)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime]
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType=WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType=WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType=WindowsRuntime]
$null = [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType=WindowsRuntime]
$null = [Windows.ApplicationModel.AppInfo, Windows.ApplicationModel, ContentType=WindowsRuntime]
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
public static class YMusicThumbnailReader {
    [DllImport("shcore.dll")]
    private static extern int CreateStreamOverRandomAccessStream(IntPtr input, ref Guid iid, out IStream stream);
    public static byte[] Read(object input) {
        IntPtr unknown = Marshal.GetIUnknownForObject(input);
        IntPtr count = Marshal.AllocHGlobal(4);
        IStream stream = null;
        try {
            Guid iid = typeof(IStream).GUID;
            Marshal.ThrowExceptionForHR(CreateStreamOverRandomAccessStream(unknown, ref iid, out stream));
            System.Runtime.InteropServices.ComTypes.STATSTG stat; stream.Stat(out stat, 1);
            if (stat.cbSize <= 0 || stat.cbSize > 2097152) return null;
            byte[] data = new byte[(int)stat.cbSize];
            stream.Seek(0, 0, IntPtr.Zero);
            stream.Read(data, data.Length, count);
            int read = Marshal.ReadInt32(count);
            if (read != data.Length) Array.Resize(ref data, read);
            return data;
        } finally {
            if (stream != null) Marshal.ReleaseComObject(stream);
            Marshal.FreeHGlobal(count); Marshal.Release(unknown);
        }
    }
}
'@
$script:AsTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.IsGenericMethodDefinition -and $_.GetGenericArguments().Count -eq 1 -and
    $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1
function Await-Operation($Operation, [Type]$ResultType) {
    $task = $script:AsTask.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
    if (-not $task.Wait(6000)) { throw 'Media session timed out.' }
    return $task.Result
}
function Read-Cover($Thumbnail) {
    if ($null -eq $Thumbnail) { return $null }
    try {
        $stream = Await-Operation $Thumbnail.OpenReadAsync() ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
        $bytes = [YMusicThumbnailReader]::Read($stream)
        if ($null -eq $bytes) { return $null }
        return @{ mime = 'image/jpeg'; data = [Convert]::ToBase64String($bytes) }
    } catch {
        if ($Diagnostics) { $script:CoverErrors += $_.Exception.Message + ' at ' + $_.InvocationInfo.Line }
        return $null
    }
}
try {
    $manager = Await-Operation ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
    $covers = @{}
    do {
        $items = @()
        $script:CoverErrors = @()
        $sessionErrors = @()
        foreach ($session in $manager.GetSessions()) {
            try {
                $sourceId = $session.SourceAppUserModelId
                $name = $sourceId
                try { $name = [Windows.ApplicationModel.AppInfo]::GetFromAppUserModelId($sourceId).DisplayInfo.DisplayName } catch {}
                $properties = Await-Operation $session.TryGetMediaPropertiesAsync() ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
                $timeline = $session.GetTimelineProperties()
                $playback = $session.GetPlaybackInfo()
                $key = $sourceId + '|' + $properties.Title + '|' + $properties.Artist + '|' + $properties.AlbumTitle
                if (-not $covers.ContainsKey($key) -or $null -eq $covers[$key]) {
                    if ($covers.Count -gt 12) { $covers.Clear() }
                    $covers[$key] = Read-Cover $properties.Thumbnail
                }
                $rate = 1.0
                if ($null -ne $playback.PlaybackRate) { $rate = [double]$playback.PlaybackRate }
                $items += @{
                    sourceId = $sourceId; name = $name; title = $properties.Title; artist = $properties.Artist
                    album = $properties.AlbumTitle; playback = $playback.PlaybackStatus.ToString()
                    positionMs = [math]::Max(0, ($timeline.Position - $timeline.StartTime).TotalMilliseconds)
                    durationMs = [math]::Max(0, ($timeline.EndTime - $timeline.StartTime).TotalMilliseconds)
                    updatedAt = $timeline.LastUpdatedTime.ToUnixTimeMilliseconds(); sampledAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
                    rate = $rate; cover = $covers[$key]
                }
            } catch {
                # A media application may disappear while its properties are being read.
                if ($Diagnostics) { $sessionErrors += $_.Exception.Message + ' at ' + $_.InvocationInfo.Line }
            }
        }
        $packet = @{ sessions = @($items); sampledAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }
        if ($Diagnostics) { $packet.sessionErrors = @($sessionErrors); $packet.coverErrors = @($script:CoverErrors); $packet.sessionCount = @($manager.GetSessions()).Count }
        $packet | ConvertTo-Json -Depth 6 -Compress | ForEach-Object { [Console]::WriteLine($_) }
        if (-not $Once) { Start-Sleep -Milliseconds 1800 }
    } while (-not $Once)
} catch {
    @{ error = $_.Exception.Message; sessions = @() } | ConvertTo-Json -Compress | ForEach-Object { [Console]::WriteLine($_) }
    exit 1
}
