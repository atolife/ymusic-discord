// Driverless, process-tree-only WASAPI loopback. Stdout is 48 kHz stereo PCM16.
// API contract: Microsoft's ApplicationLoopback sample and mmdeviceapi/audioclient.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

[ComImport, Guid("1CB9AD4C-DBFA-4C32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioClient {
    [PreserveSig] int Initialize(int mode, uint flags, long duration, long periodicity, ref WaveFormat format, IntPtr session);
    [PreserveSig] int GetBufferSize(out uint frames);
    [PreserveSig] int GetStreamLatency(out long latency);
    [PreserveSig] int GetCurrentPadding(out uint frames);
    [PreserveSig] int IsFormatSupported(int mode, IntPtr format, out IntPtr closest);
    [PreserveSig] int GetMixFormat(out IntPtr format);
    [PreserveSig] int GetDevicePeriod(out long normal, out long minimum);
    [PreserveSig] int Start();
    [PreserveSig] int Stop();
    [PreserveSig] int Reset();
    [PreserveSig] int SetEventHandle(IntPtr handle);
    [PreserveSig] int GetService(ref Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object service);
}
[ComImport, Guid("C8ADBD64-E71E-48A0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioCaptureClient {
    [PreserveSig] int GetBuffer(out IntPtr data, out uint frames, out uint flags, out ulong position, out ulong timestamp);
    [PreserveSig] int ReleaseBuffer(uint frames);
    [PreserveSig] int GetNextPacketSize(out uint frames);
}
[ComImport, Guid("72A22D78-CDE4-431D-B8CC-843A71199B6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IActivateAudioInterfaceAsyncOperation {
    [PreserveSig] int GetActivateResult(out int result, [MarshalAs(UnmanagedType.IUnknown)] out object activated);
}
[ComVisible(true), Guid("41D949AB-9862-444A-80F6-C261334DA5EB"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IActivateAudioInterfaceCompletionHandler {
    [PreserveSig] int ActivateCompleted(IActivateAudioInterfaceAsyncOperation operation);
}
[ComVisible(true), Guid("94EA2B94-E9CC-49E0-C0FF-EE64CA8F5B90"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAgileObject { }
[ComVisible(true), ClassInterface(ClassInterfaceType.None)]
public sealed class ActivationHandler : IActivateAudioInterfaceCompletionHandler, IAgileObject {
    public readonly ManualResetEvent Done = new ManualResetEvent(false);
    public IAudioClient Client;
    public Exception Error;
    public int ActivateCompleted(IActivateAudioInterfaceAsyncOperation operation) {
        try {
            int result; object activated;
            Marshal.ThrowExceptionForHR(operation.GetActivateResult(out result, out activated));
            Marshal.ThrowExceptionForHR(result);
            Client = (IAudioClient)activated;
        } catch (Exception error) { Error = error; }
        finally { Done.Set(); }
        return 0;
    }
}
[StructLayout(LayoutKind.Sequential, Pack = 2)]
public struct WaveFormat {
    public ushort Tag, Channels;
    public uint Rate, BytesPerSecond;
    public ushort BlockAlign, Bits, Extra;
}
[StructLayout(LayoutKind.Sequential)]
public struct ActivationParams { public uint Type, ProcessId, Mode; }
[StructLayout(LayoutKind.Explicit, Size = 24)]
public struct PropVariant {
    [FieldOffset(0)] public ushort Type;
    [FieldOffset(8)] public uint Size;
    [FieldOffset(16)] public IntPtr Data;
}

internal sealed class PcmRing {
    private readonly byte[] data = new byte[3840 * 6];
    private int start, count;
    public void Write(byte[] input, int length) {
        lock (data) {
            int offset = 0;
            if (length > data.Length) { offset = length - data.Length; length = data.Length; }
            int discard = Math.Max(0, count + length - data.Length);
            start = (start + discard) % data.Length; count -= discard;
            int end = (start + count) % data.Length;
            int first = Math.Min(length, data.Length - end);
            Buffer.BlockCopy(input, offset, data, end, first);
            Buffer.BlockCopy(input, offset + first, data, 0, length - first);
            count += length;
        }
    }
    public void Read(byte[] output) {
        Array.Clear(output, 0, output.Length);
        lock (data) {
            int length = Math.Min(count, output.Length), first = Math.Min(length, data.Length - start);
            Buffer.BlockCopy(data, start, output, 0, first);
            Buffer.BlockCopy(data, 0, output, first, length - first);
            start = (start + length) % data.Length; count -= length;
        }
    }
}

public static class Program {
    [DllImport("mmdevapi.dll", ExactSpelling = true)]
    private static extern int ActivateAudioInterfaceAsync([MarshalAs(UnmanagedType.LPWStr)] string device,
        ref Guid iid, IntPtr parameters, IActivateAudioInterfaceCompletionHandler handler,
        out IActivateAudioInterfaceAsyncOperation operation);
    [DllImport("ole32.dll")] private static extern int CoInitializeEx(IntPtr reserved, uint mode);
    [DllImport("ole32.dll")] private static extern void CoUninitialize();
    [DllImport("ntdll.dll")] private static extern int RtlGetVersion(ref OsVersion version);
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct OsVersion {
        public uint Size, Major, Minor, Build, Platform;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string ServicePack;
    }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct ProcessEntry {
        public uint Size, Usage, Id; public IntPtr Heap; public uint Module, Threads, Parent;
        public int Priority; public uint Flags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string Exe;
    }
    [DllImport("kernel32.dll")] private static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint process);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern bool Process32FirstW(IntPtr snapshot, ref ProcessEntry entry);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern bool Process32NextW(IntPtr snapshot, ref ProcessEntry entry);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);
    private static volatile bool stopping;

    public static bool IsYandex(string file) {
        string name = Path.GetFileNameWithoutExtension(file);
        return String.Equals(name, "Яндекс Музыка", StringComparison.OrdinalIgnoreCase)
            || String.Equals(name, "YandexMusic", StringComparison.OrdinalIgnoreCase);
    }
    private static uint WindowsBuild() {
        OsVersion value = new OsVersion(); value.Size = (uint)Marshal.SizeOf(value);
        Marshal.ThrowExceptionForHR(RtlGetVersion(ref value)); return value.Build;
    }
    private static List<object> Applications() {
        Dictionary<uint, uint> parents = new Dictionary<uint, uint>();
        IntPtr snapshot = CreateToolhelp32Snapshot(2, 0);
        if (snapshot == new IntPtr(-1)) throw new Exception("Не удалось прочитать список приложений.");
        try {
            ProcessEntry entry = new ProcessEntry(); entry.Size = (uint)Marshal.SizeOf(entry);
            if (Process32FirstW(snapshot, ref entry)) do { parents[entry.Id] = entry.Parent; } while (Process32NextW(snapshot, ref entry));
        } finally { CloseHandle(snapshot); }
        Dictionary<uint, Process> candidates = new Dictionary<uint, Process>();
        foreach (Process process in Process.GetProcesses()) {
            try { if (IsYandex(process.ProcessName)) candidates[(uint)process.Id] = process; else process.Dispose(); }
            catch { process.Dispose(); }
        }
        List<object> result = new List<object>();
        try {
            foreach (KeyValuePair<uint, Process> pair in candidates) {
                uint parent;
                if (parents.TryGetValue(pair.Key, out parent) && candidates.ContainsKey(parent)) continue;
                try {
                    string executable = pair.Value.MainModule.FileName;
                    if (!IsYandex(executable)) continue;
                    result.Add(new { pid = pair.Key, startTicks = pair.Value.StartTime.ToUniversalTime().Ticks.ToString(),
                        path = executable, name = "Яндекс Музыка" });
                } catch { }
            }
        } finally { foreach (Process process in candidates.Values) process.Dispose(); }
        return result;
    }
    private static void Check(int result) { Marshal.ThrowExceptionForHR(result); }

    private static void Capture(Process target) {
        Check(CoInitializeEx(IntPtr.Zero, 0));
        IntPtr activationData = IntPtr.Zero, variantData = IntPtr.Zero;
        ActivationHandler handler = new ActivationHandler();
        IActivateAudioInterfaceAsyncOperation operation = null;
        IAudioClient client = null; IAudioCaptureClient capture = null;
        AutoResetEvent sample = new AutoResetEvent(false);
        Thread producer = null; Exception producerError = null;
        bool started = false;
        try {
            ActivationParams parameters = new ActivationParams { Type = 1, ProcessId = (uint)target.Id, Mode = 0 };
            activationData = Marshal.AllocHGlobal(Marshal.SizeOf(parameters));
            Marshal.StructureToPtr(parameters, activationData, false);
            PropVariant variant = new PropVariant { Type = 65, Size = (uint)Marshal.SizeOf(parameters), Data = activationData };
            variantData = Marshal.AllocHGlobal(Marshal.SizeOf(variant));
            Marshal.StructureToPtr(variant, variantData, false);
            Guid audioId = typeof(IAudioClient).GUID;
            Check(ActivateAudioInterfaceAsync("VAD\\Process_Loopback", ref audioId, variantData, handler, out operation));
            if (!handler.Done.WaitOne(8000)) throw new Exception("Windows не ответила на запрос захвата приложения за 8 секунд.");
            if (handler.Error != null) throw handler.Error;
            client = handler.Client;
            WaveFormat format = new WaveFormat { Tag = 1, Channels = 2, Rate = 48000, Bits = 16, BlockAlign = 4, BytesPerSecond = 192000, Extra = 0 };
            Check(client.Initialize(0, 0x00020000 | 0x00040000 | 0x80000000 | 0x08000000, 0, 0, ref format, IntPtr.Zero));
            Check(client.SetEventHandle(sample.SafeWaitHandle.DangerousGetHandle()));
            Guid captureId = typeof(IAudioCaptureClient).GUID; object value;
            Check(client.GetService(ref captureId, out value)); capture = (IAudioCaptureClient)value;
            PcmRing ring = new PcmRing();
            producer = new Thread(delegate() {
                try {
                    while (!stopping) {
                        sample.WaitOne(40);
                        uint next; Check(capture.GetNextPacketSize(out next));
                        while (next > 0 && !stopping) {
                            IntPtr pointer; uint frames, flags; ulong position, timestamp;
                            Check(capture.GetBuffer(out pointer, out frames, out flags, out position, out timestamp));
                            try {
                                if (frames > 192000) throw new Exception("Windows вернула слишком большой аудиобуфер.");
                                byte[] bytes = new byte[(int)frames * 4];
                                if ((flags & 2) == 0 && pointer != IntPtr.Zero) Marshal.Copy(pointer, bytes, 0, bytes.Length);
                                ring.Write(bytes, bytes.Length);
                            } finally { Check(capture.ReleaseBuffer(frames)); }
                            Check(capture.GetNextPacketSize(out next));
                        }
                    }
                } catch (Exception error) { producerError = error; stopping = true; }
            });
            producer.IsBackground = true; producer.SetApartmentState(ApartmentState.MTA);
            Check(client.Start()); started = true; producer.Start();
            Console.Error.WriteLine("READY process=" + target.Id + " format=48000/stereo/pcm16");
            byte[] frame = new byte[3840];
            Stream output = Console.OpenStandardOutput();
            Stopwatch clock = Stopwatch.StartNew(); long nextAt = 40; int counter = 0;
            while (!stopping) {
                long wait = nextAt - clock.ElapsedMilliseconds;
                if (wait > 0) { Thread.Sleep((int)Math.Min(wait, 10)); continue; }
                if (clock.ElapsedMilliseconds - nextAt > 100) nextAt = clock.ElapsedMilliseconds;
                if (++counter % 25 == 0 && target.HasExited) throw new Exception("Яндекс Музыка закрыта. Открой приложение снова.");
                ring.Read(frame); output.Write(frame, 0, frame.Length); nextAt += 20;
            }
            if (producerError != null) throw producerError;
        } finally {
            stopping = true; sample.Set();
            bool joined = producer == null || !producer.IsAlive || producer.Join(2000);
            if (joined) {
                if (started && client != null) { try { client.Stop(); } catch { } }
                if (capture != null) Marshal.ReleaseComObject(capture);
                if (client != null) Marshal.ReleaseComObject(client);
                sample.Dispose();
            }
            if (operation != null) Marshal.ReleaseComObject(operation);
            // On timeout the native operation can still own the callback and its parameters.
            if (handler.Done.WaitOne(0)) {
                handler.Done.Dispose();
                if (variantData != IntPtr.Zero) Marshal.FreeHGlobal(variantData);
                if (activationData != IntPtr.Zero) Marshal.FreeHGlobal(activationData);
            }
            CoUninitialize();
        }
    }
    [MTAThread]
    public static int Main(string[] args) {
        Console.OutputEncoding = new UTF8Encoding(false);
        Console.InputEncoding = new UTF8Encoding(false);
        Console.CancelKeyPress += delegate(object sender, ConsoleCancelEventArgs e) { e.Cancel = true; stopping = true; };
        try {
            uint build = WindowsBuild();
            if (args.Length == 1 && args[0] == "--list") {
                Console.WriteLine(new JavaScriptSerializer().Serialize(new { supported = build >= 20348, build = build, applications = Applications() }));
                return 0;
            }
            if (build < 20348) throw new Exception("Захват приложения требует Windows build 20348 или новее. Выбери VB-CABLE.");
            if (args.Length == 1 && args[0] == "--probe-self") {
                using (Process self = Process.GetCurrentProcess()) Capture(self);
                return 0;
            }
            if (args.Length != 4 || args[0] != "--capture") throw new Exception("Использование: --list или --capture PID START_TICKS EXE_PATH.");
            int pid; long ticks;
            if (!Int32.TryParse(args[1], out pid) || pid <= 0 || !Int64.TryParse(args[2], out ticks)) throw new Exception("Некорректный идентификатор приложения.");
            using (Process target = Process.GetProcessById(pid)) {
                string executable = target.MainModule.FileName;
                if (!IsYandex(executable) || !String.Equals(executable, args[3], StringComparison.OrdinalIgnoreCase)
                    || target.StartTime.ToUniversalTime().Ticks != ticks) throw new Exception("Приложение изменилось. Обнови список источников и выбери Яндекс Музыку.");
                Capture(target);
            }
            return 0;
        } catch (IOException) { return 0; } // Parent closed the PCM pipe.
        catch (Exception error) { Console.Error.WriteLine(error.Message + " (0x" + error.HResult.ToString("X8") + ")"); return 1; }
    }
}
