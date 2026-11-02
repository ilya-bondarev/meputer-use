// Read application text through the browser's accessibility provider, without pixels or DOM injection.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Windows.Automation;

static partial class WindowsUiaHost {
    static AutomationElement ActiveDocument(IntPtr handle) {
        // Firefox can keep an old provider readable during navigation. A cached
        // root can combine the previous page's text with the next URL.
        var root = AutomationElement.FromHandle(handle).FindFirst(TreeScope.Descendants, new AndCondition(
            new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Document),
            new PropertyCondition(AutomationElement.IsOffscreenProperty, false)));
        if (root == null) throw new HostFault("ACTIVE_DOCUMENT_UNAVAILABLE", "No active accessibility document");
        return root;
    }
    static object Document(Dictionary<string, object> request) {
        var watch = Stopwatch.StartNew();
        var handle = ValidateWindow(request);
        uint input = InputTick();
        var root = ActiveDocument(handle);
        int limit = Number(request, "maxChars", 100000, 1, 500000);
        object pattern;
        string url = "";
        if (root.TryGetCurrentPattern(ValuePattern.Pattern, out pattern)) url = ((ValuePattern)pattern).Current.Value;
        if (!root.TryGetCurrentPattern(TextPattern.Pattern, out pattern))
            throw new HostFault("TEXT_PATTERN_UNAVAILABLE", "Use a bounded UIA snapshot for this application");
        var text = ((TextPattern)pattern).DocumentRange.GetText(limit + 1);
        bool truncated = text.Length > limit;
        if (truncated) text = text.Substring(0, limit);
        return Map("window", Window(handle), "url", url, "title", root.Current.Name,
            "text", text, "truncated", truncated, "elapsedMs", watch.Elapsed.TotalMilliseconds,
            "lastInputTick", input, "inputChangedDuringRead", input != InputTick());
    }
}
