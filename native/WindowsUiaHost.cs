// A separate application, not a client for the Codex Computer Use helper.
// JSON-lines over inherited pipes only. Native input lives in the partial files.
using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows;
using System.Windows.Automation;

sealed class HostFault : Exception {
    public readonly string Code;
    public HostFault(string code, string message) : base(message) { Code = code; }
}

static partial class WindowsUiaHost {
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 25165824 };
    static readonly Dictionary<string, AutomationElement> Elements = new Dictionary<string, AutomationElement>();
    static readonly Dictionary<string, Dictionary<string, object>> Descriptions = new Dictionary<string, Dictionary<string, object>>();
    static readonly Dictionary<string, AutomationElement> Scopes = new Dictionary<string, AutomationElement>();
    static bool AllowInput;
    static string StopFile;
    static string SnapshotId;
    static long BoundWindow;
    static int BoundProcess;
    static uint ObservedInput;
    static long SnapshotCompletedAt;
    delegate bool EnumProc(IntPtr window, IntPtr parameter);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr parameter);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr window, StringBuilder text, int count);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [StructLayout(LayoutKind.Sequential)] struct LastInput { public uint cbSize; public uint dwTime; }
    [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LastInput input);

    static Dictionary<string, object> Map(params object[] values) {
        var result = new Dictionary<string, object>();
        for (int i = 0; i < values.Length; i += 2) result[(string)values[i]] = values[i + 1];
        return result;
    }
    static object Get(Dictionary<string, object> data, string key, object fallback) {
        object value; return data.TryGetValue(key, out value) ? value : fallback;
    }
    static string Text(Dictionary<string, object> data, string key, string fallback) { return Convert.ToString(Get(data, key, fallback)); }
    static int Number(Dictionary<string, object> data, string key, int fallback, int min, int max) {
        int value = Convert.ToInt32(Get(data, key, fallback));
        if (value < min || value > max) throw new HostFault("INVALID_REQUEST", "Invalid range: " + key);
        return value;
    }
    static bool Flag(Dictionary<string, object> data, string key, bool fallback) { return Convert.ToBoolean(Get(data, key, fallback)); }
    static uint InputTick() {
        var data = new LastInput { cbSize = (uint)Marshal.SizeOf(typeof(LastInput)) };
        if (!GetLastInputInfo(ref data)) throw new HostFault("INPUT_STATE_UNAVAILABLE", "Cannot read last input state");
        return data.dwTime;
    }
    static string ProcessName(int pid) {
        try { using (var process = Process.GetProcessById(pid)) return process.ProcessName; }
        catch { throw new HostFault("WINDOW_GONE", "Process is no longer available"); }
    }
    static string Title(IntPtr window) {
        var text = new StringBuilder(2048); GetWindowText(window, text, text.Capacity); return text.ToString();
    }
    static bool Restricted(string name) {
        string n = name.ToLowerInvariant();
        return new HashSet<string> { "codex", "chatgpt", "windowsterminal", "cmd", "powershell", "pwsh", "conhost", "consent", "credentialuibroker", "logonui", "lockapp", "sechealthui", "msmpeng", "keepass", "keepassxc", "1password", "bitwarden" }.Contains(n);
    }
    static Dictionary<string, object> Window(IntPtr handle) {
        uint pid; GetWindowThreadProcessId(handle, out pid);
        string name = ProcessName((int)pid);
        return Map("id", handle.ToInt64(), "processId", (int)pid, "processName", name,
            "title", Title(handle), "foreground", GetForegroundWindow() == handle, "restricted", Restricted(name));
    }
    static IntPtr ValidateWindow(Dictionary<string, object> request) {
        var handle = new IntPtr(Convert.ToInt64(Get(request, "windowId", 0)));
        uint pid; GetWindowThreadProcessId(handle, out pid);
        if (!IsWindow(handle) || pid == 0 || pid != Convert.ToUInt32(Get(request, "processId", 0)))
            throw new HostFault("WINDOW_GONE", "Window/process binding changed");
        if (Restricted(ProcessName((int)pid))) throw new HostFault("RESTRICTED_APP", "This application is outside executor scope");
        return handle;
    }
    static List<object> ListWindows() {
        var result = new List<object>();
        EnumWindows(delegate(IntPtr handle, IntPtr unused) {
            try { if (IsWindowVisible(handle) && Title(handle).Length != 0) result.Add(Window(handle)); } catch { }
            return true;
        }, IntPtr.Zero);
        return result;
    }
    static CacheRequest Cache() {
        var cache = new CacheRequest();
        cache.TreeScope = TreeScope.Element;
        cache.TreeFilter = Automation.ControlViewCondition;
        cache.AutomationElementMode = AutomationElementMode.Full;
        foreach (var property in new AutomationProperty[] {
            AutomationElement.NameProperty, AutomationElement.AutomationIdProperty,
            AutomationElement.ControlTypeProperty, AutomationElement.LocalizedControlTypeProperty, AutomationElement.IsEnabledProperty,
            AutomationElement.IsOffscreenProperty, AutomationElement.IsPasswordProperty, AutomationElement.HasKeyboardFocusProperty, AutomationElement.BoundingRectangleProperty
        }) cache.Add(property);
        return cache;
    }
    static object Cached(AutomationElement element, AutomationProperty property, object fallback) {
        try { object value = element.GetCachedPropertyValue(property, true); return value == AutomationElement.NotSupported ? fallback : value; }
        catch { return fallback; }
    }
    static Dictionary<string, object> Describe(AutomationElement element, string reference, string parent, int depth, bool values) {
        bool password = (bool)Cached(element, AutomationElement.IsPasswordProperty, false);
        var type = Cached(element, AutomationElement.ControlTypeProperty, ControlType.Custom) as ControlType;
        var actions = new List<string>();
        // Cheap role hints only. Actual pattern support is checked on the chosen
        // control immediately before an action; probing all patterns is expensive.
        if (type == ControlType.Button || type == ControlType.Hyperlink || type == ControlType.MenuItem || type == ControlType.SplitButton) actions.Add("invoke");
        if (!password && type == ControlType.Edit) actions.Add("set_value");
        if (type == ControlType.ListItem || type == ControlType.TreeItem || type == ControlType.TabItem || type == ControlType.RadioButton) actions.Add("select");
        if (type == ControlType.CheckBox) actions.Add("toggle");
        if (type == ControlType.TreeItem || type == ControlType.ComboBox) { actions.Add("expand"); actions.Add("collapse"); }
        var result = Map("ref", reference, "parent", parent, "depth", depth,
            "name", Cached(element, AutomationElement.NameProperty, ""),
            "automationId", Cached(element, AutomationElement.AutomationIdProperty, ""),
            "role", type.ProgrammaticName.Replace("ControlType.", ""),
            "kind", Cached(element, AutomationElement.LocalizedControlTypeProperty, ""),
            "enabled", Cached(element, AutomationElement.IsEnabledProperty, false),
            "offscreen", Cached(element, AutomationElement.IsOffscreenProperty, true),
            "password", password, "focused", Cached(element, AutomationElement.HasKeyboardFocusProperty, false), "actions", actions);
        var bounds = (Rect)Cached(element, AutomationElement.BoundingRectangleProperty, Rect.Empty);
        if (!bounds.IsEmpty) result["bounds"] = Map("x", bounds.X, "y", bounds.Y, "width", bounds.Width, "height", bounds.Height);
        if (values && !password) {
            object pattern;
            try {
                if ((type == ControlType.Edit || type == ControlType.ComboBox || type == ControlType.Hyperlink || type == ControlType.Document) && element.TryGetCurrentPattern(ValuePattern.Pattern, out pattern))
                    result["value"] = ((ValuePattern)pattern).Current.Value;
                if (type == ControlType.Hyperlink && !result.ContainsKey("value")) {
                    var property=AutomationProperty.LookupById(30093); // UIA_LegacyIAccessibleValuePropertyId
                    if(property!=null) {
                        var legacy=element.GetCurrentPropertyValue(property,true);
                        if(legacy is string && ((string)legacy).Length>0) result["value"]=legacy;
                    }
                }
                if (actions.Contains("toggle") && element.TryGetCurrentPattern(TogglePattern.Pattern, out pattern))
                    result["toggleState"] = ((TogglePattern)pattern).Current.ToggleState.ToString();
                if (actions.Contains("select") && element.TryGetCurrentPattern(SelectionItemPattern.Pattern, out pattern))
                    result["selected"] = ((SelectionItemPattern)pattern).Current.IsSelected;
                if (actions.Contains("expand") && element.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out pattern))
                    result["expandState"] = ((ExpandCollapsePattern)pattern).Current.ExpandCollapseState.ToString();
            } catch (ElementNotAvailableException) { throw; }
            catch { result["valueUnavailable"] = true; }
        }
        return result;
    }
    sealed class Pending {
        public AutomationElement Element; public string Parent; public int Depth;
        public Pending(AutomationElement element, string parent, int depth) { Element = element; Parent = parent; Depth = depth; }
    }
    static Condition ScopeCondition(Dictionary<string, object> selector) {
        var conditions = new List<Condition>();
        if (selector.ContainsKey("automationId")) conditions.Add(new PropertyCondition(AutomationElement.AutomationIdProperty, Text(selector, "automationId", "")));
        if (selector.ContainsKey("name")) conditions.Add(new PropertyCondition(AutomationElement.NameProperty, Text(selector, "name", "")));
        if (conditions.Count == 0) throw new HostFault("INVALID_REQUEST", "Scope requires exact automationId or name");
        return conditions.Count == 1 ? conditions[0] : new AndCondition(conditions.ToArray());
    }
    static object Snapshot(Dictionary<string, object> request) {
        IntPtr handle = ValidateWindow(request);
        int maxElements = Number(request, "maxElements", 250, 1, 1000);
        int maxDepth = Number(request, "maxDepth", 12, 0, 30);
        int budget = Number(request, "budgetMs", 1500, 50, 10000);
        bool values = Flag(request, "includeValues", false);
        Elements.Clear(); Descriptions.Clear(); SnapshotId = Guid.NewGuid().ToString("N");
        BoundWindow = handle.ToInt64(); BoundProcess = Convert.ToInt32(request["processId"]); ObservedInput = InputTick();
        var watch = Stopwatch.StartNew();
        var root = AutomationElement.FromHandle(handle);
        if(Flag(request,"activeDocument",false)) {
            root=ActiveDocument(handle);
        }
        object scope;
        if (request.TryGetValue("scope", out scope) && scope != null) {
            var selector = (Dictionary<string, object>)scope;
            string key = BoundWindow + ":" + BoundProcess + ":" + Json.Serialize(selector);
            AutomationElement cached;
            bool valid = false;
            if (Scopes.TryGetValue(key, out cached)) {
                try {
                    var current = cached.Current;
                    valid = current.ProcessId == BoundProcess &&
                        (!selector.ContainsKey("automationId") || current.AutomationId == Text(selector, "automationId", "")) &&
                        (!selector.ContainsKey("name") || current.Name == Text(selector, "name", ""));
                } catch { Scopes.Remove(key); }
            }
            if (valid) root = cached;
            else {
                var matches = root.FindAll(TreeScope.Descendants, ScopeCondition(selector));
                if (matches.Count != 1) throw new HostFault("SCOPE_NOT_UNIQUE", "Expected exactly one scope; got " + matches.Count);
                root = matches[0];
                if (Scopes.Count >= 16) Scopes.Clear();
                Scopes[key] = root;
            }
        }
        var nodes = new List<object>();
        var queue = new Queue<Pending>();
        var cache = Cache();
        queue.Enqueue(new Pending(root.GetUpdatedCache(cache), null, 0));
        bool truncated = false;
        using (cache.Activate()) {
            while (queue.Count != 0) {
                if (nodes.Count >= maxElements || watch.ElapsedMilliseconds >= budget) { truncated = true; break; }
                var pending = queue.Dequeue();
                string reference = SnapshotId + ":" + nodes.Count;
                var description = Describe(pending.Element, reference, pending.Parent, pending.Depth, values);
                nodes.Add(description); Elements[reference] = pending.Element; Descriptions[reference] = description;
                if (pending.Depth >= maxDepth) { truncated = true; continue; }
                // Minimized/occluded containers may still expose useful descendants.
                // Pruning them would make a partial observation look complete.
                // Cache only one bounded level; a whole-window subtree request can
                // block on virtualized providers. Reuse a scoped root across reads.
                var children = pending.Element.FindAll(TreeScope.Children, Automation.ControlViewCondition);
                for (int i = 0; i < children.Count; i++) {
                    if (queue.Count + nodes.Count >= maxElements) { truncated = true; break; }
                    queue.Enqueue(new Pending(children[i], reference, pending.Depth + 1));
                }
            }
        }
        SnapshotCompletedAt = Stopwatch.GetTimestamp();
        return Map("id", SnapshotId, "window", Window(handle), "elements", nodes, "truncated", truncated,
            "elapsedMs", watch.Elapsed.TotalMilliseconds, "lastInputTick", ObservedInput,
            "inputChangedDuringRead", ObservedInput != InputTick());
    }
    static object Act(Dictionary<string, object> request) {
        // This check precedes every possible UI mutation, even malformed requests.
        if (!AllowInput) throw new HostFault("READ_ONLY", "Native input is disabled for this process");
        if (StopFile != null && File.Exists(StopFile)) throw new HostFault("STOP_REQUESTED", "Stop file exists");
        if (!InteractiveDesktop()) throw new HostFault("DESKTOP_UNAVAILABLE", "Interactive desktop is locked or unavailable");
        IntPtr handle = ValidateWindow(request);
        if (handle.ToInt64() != BoundWindow || Convert.ToInt32(request["processId"]) != BoundProcess)
            throw new HostFault("STALE_SNAPSHOT", "Wrong snapshot window");
        if (GetForegroundWindow() != handle) throw new HostFault("USER_INTERFERENCE", "Target lost foreground after observation");
        if (InputTick() != ObservedInput) throw new HostFault("USER_INTERFERENCE", "User input occurred after observation");
        string reference = Text(request, "ref", "");
        AutomationElement element;
        if (!Elements.TryGetValue(reference, out element)) throw new HostFault("STALE_SNAPSHOT", "Element reference expired");
        if ((Stopwatch.GetTimestamp() - SnapshotCompletedAt) / (double)Stopwatch.Frequency > 2.0)
            throw new HostFault("STALE_SNAPSHOT", "Observation is older than two seconds");
        var previous = Descriptions[reference];
        var current = element.Current;
        if (current.IsPassword) throw new HostFault("PASSWORD_FIELD", "Password elements are outside scope");
        if (!current.IsEnabled || current.IsOffscreen) throw new HostFault("NOT_ACTIONABLE", "Element is disabled or offscreen");
        if (current.Name != Convert.ToString(previous["name"]) || current.AutomationId != Convert.ToString(previous["automationId"]) ||
            current.ControlType.ProgrammaticName.Replace("ControlType.", "") != Convert.ToString(previous["role"]))
            throw new HostFault("STALE_SNAPSHOT", "Element identity changed");
        string action = Text(request, "action", "");
        AutomationPattern required = action == "invoke" ? InvokePattern.Pattern : action == "set_value" ? ValuePattern.Pattern :
            action == "select" ? SelectionItemPattern.Pattern : action == "toggle" ? TogglePattern.Pattern :
            (action == "expand" || action == "collapse") ? ExpandCollapsePattern.Pattern : null;
        if (required == null) throw new HostFault("INVALID_ACTION", "Unsupported UIA action");
        object supported;
        if (!element.TryGetCurrentPattern(required, out supported)) throw new HostFault("NOT_ACTIONABLE", "Required UIA pattern is unavailable");
        if (GetForegroundWindow() != handle || InputTick() != ObservedInput)
            throw new HostFault("USER_INTERFERENCE", "User activity changed during validation");
        if (StopFile != null && File.Exists(StopFile)) throw new HostFault("STOP_REQUESTED", "Stop file exists");
        // A reference is consumed before the first mutation. Never retry automatically.
        Elements.Clear(); Descriptions.Clear(); FrameId=null;
        if (action == "invoke") ((InvokePattern)supported).Invoke();
        else if (action == "set_value") {
            var pattern = (ValuePattern)supported;
            if (pattern.Current.IsReadOnly) throw new HostFault("NOT_ACTIONABLE", "Value is read-only");
            pattern.SetValue(Text(request, "value", ""));
        }
        else if (action == "select") ((SelectionItemPattern)supported).Select();
        else if (action == "toggle") ((TogglePattern)supported).Toggle();
        else if (action == "expand") ((ExpandCollapsePattern)supported).Expand();
        else if (action == "collapse") ((ExpandCollapsePattern)supported).Collapse();
        else throw new HostFault("INVALID_ACTION", "Unsupported UIA action");
        return Map("performed", true, "action", action, "lastInputTick", AcknowledgeInput());
    }
    static object Dispatch(Dictionary<string, object> request) {
        string method = Text(request, "method", "");
        if (method == "hello") return Map("protocol", 1, "readOnly", !AllowInput, "pid", Process.GetCurrentProcess().Id,
            "architecture", Environment.Is64BitProcess ? "x64" : "x86", "runtime", Environment.Version.ToString(), "workingSetBytes", Process.GetCurrentProcess().WorkingSet64,
            "interactiveDesktop", InteractiveDesktop(), "inputIdleMs", InputIdleMs());
        if (method == "windows") return ListWindows();
        if (method == "window") return Window(ValidateWindow(request));
        if (method == "classify") return Map("restricted", Restricted(Text(request,"processName","")));
        if (method == "snapshot") return Snapshot(request);
        if (method == "document") return Document(request);
        if (method == "frame") return Frame(request);
        if (method == "capture") return Capture(request);
        if (method == "geometry") return Geometry(request);
        if (method == "capture_visible") return CaptureVisible(request);
        if (method == "lease_acquire") return AcquireInputLease();
        if (method == "lease_release") return ReleaseInputLease();
        if (method == "admin_status") return AdminStatus(request);
        if (method == "admin_launch") return AdminLaunch(request);
        if (method == "act" || method == "desktop" || method == "secret" || method == "sequence" || method == "layout") {
            // Hold the system-wide lock only while delivering a mutation.
            // Sleeping workers and idle MCP servers must not monopolize input.
            using (var mutex = new System.Threading.Mutex(false, "Local\\MeSystemWindowsExecutorInput")) {
                try { if (!mutex.WaitOne(0)) throw new HostFault("INPUT_BUSY", "Another executor is delivering input"); }
                catch (System.Threading.AbandonedMutexException) { }
                InputWasDelivered=false;
                try { return method == "act" ? Act(request) : method == "secret" ? FillSecret(request) : method == "sequence" ? Sequence(request) : method == "layout" ? Layout(request) : Desktop(request); }
                catch (HostFault fault) {
                    if((method=="sequence" || method=="desktop" && Text(request,"operation","")!="activate") && InputWasDelivered)
                        throw new HostFault("ACTION_INTERRUPTED","Input was partially delivered; reconcile outcome: "+fault.Code);
                    throw;
                }
                finally { mutex.ReleaseMutex(); }
            }
        }
        throw new HostFault("INVALID_METHOD", "Unknown method");
    }
    [MTAThread]
    static void Main(string[] args) {
        SetProcessDPIAware();
        AllowInput = Array.IndexOf(args, "--allow-input") >= 0;
        for (int i = 0; i < args.Length - 1; i++) if (args[i] == "--stop-file") StopFile = Path.GetFullPath(args[i + 1]);
        try { Process.GetCurrentProcess().PriorityClass = ProcessPriorityClass.BelowNormal; } catch { }
        Console.InputEncoding = new UTF8Encoding(false); Console.OutputEncoding = new UTF8Encoding(false);
        string line;
        while ((line = Console.ReadLine()) != null) {
            object id = null;
            try {
                if (line.Length > 1048576) throw new HostFault("INVALID_REQUEST", "Request too large");
                var request = Json.Deserialize<Dictionary<string, object>>(line);
                id = Get(request, "id", null);
                Console.WriteLine(Json.Serialize(Map("id", id, "result", Dispatch(request))));
            } catch (Exception error) {
                var fault = error as HostFault;
                string code = fault != null ? fault.Code : error is ElementNotAvailableException ? "ELEMENT_GONE" : "UIA_ERROR";
                // Exception messages can contain user document text. Keep protocol errors bounded.
                Console.WriteLine(Json.Serialize(Map("id", id, "error", Map("code", code, "message", fault != null ? fault.Message : error.GetType().Name))));
            }
            Console.Out.Flush();
        }
    }
}
