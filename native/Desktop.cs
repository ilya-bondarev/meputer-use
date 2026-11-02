using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

static partial class WindowsUiaHost {
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] struct POINT { public int X, Y; public POINT(int x, int y) { X=x; Y=y; } }
    [StructLayout(LayoutKind.Sequential)] struct MOUSE { public int X,Y; public uint Data,Flags,Time; public UIntPtr Extra; }
    [StructLayout(LayoutKind.Sequential)] struct KEY { public ushort Vk,Scan; public uint Flags,Time; public UIntPtr Extra; }
    [StructLayout(LayoutKind.Explicit)] struct INPUTUNION { [FieldOffset(0)] public MOUSE Mouse; [FieldOffset(0)] public KEY Key; }
    [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint Type; public INPUTUNION Data; }
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int command);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] static extern uint SendInput(uint n, INPUT[] inputs, int size);
    [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT p);
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint flags);
    [DllImport("user32.dll")] static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
    [DllImport("user32.dll")] static extern bool CloseDesktop(IntPtr desktop);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern bool GetUserObjectInformation(IntPtr h,int index,System.Text.StringBuilder text,int length,out int needed);
    static uint OwnedInput;
    static bool InputWasDelivered;
    static uint AcknowledgeInput() { OwnedInput=InputTick(); return OwnedInput; }
    static long InputIdleMs() { var tick=InputTick(); return tick==OwnedInput ? Int32.MaxValue : unchecked((uint)Environment.TickCount-tick); }
    static bool InteractiveDesktop() {
        var desktop=OpenInputDesktop(0,false,1);
        if(desktop==IntPtr.Zero) return false;
        try { int needed; var name=new System.Text.StringBuilder(256); return GetUserObjectInformation(desktop,2,name,512,out needed)&&name.ToString()=="Default"; }
        finally { CloseDesktop(desktop); }
    }
    static string FrameId;
    static long FrameWindow, FrameAt;
    static int FrameProcess;
    static uint FrameInput;
    static RECT FrameBounds;
    static void InputAllowed() {
        if (!AllowInput) throw new HostFault("READ_ONLY", "Native input is disabled");
        if (StopFile != null && File.Exists(StopFile)) throw new HostFault("STOP_REQUESTED", "Stop file exists");
        if (!InteractiveDesktop()) throw new HostFault("DESKTOP_UNAVAILABLE", "Interactive desktop is locked or unavailable");
    }
    static RECT Bounds(IntPtr h) {
        RECT r;
        if (!GetWindowRect(h, out r) || r.Right<=r.Left || r.Bottom<=r.Top || IsIconic(h))
            throw new HostFault("WINDOW_NOT_VISIBLE", "Restore window before capture");
        return r;
    }
    static Dictionary<string, object> Frame(Dictionary<string, object> request) {
        var h = ValidateWindow(request);
        if (GetForegroundWindow()!=h) throw new HostFault("WINDOW_NOT_FOREGROUND", "Activate target before screen capture");
        var r = Bounds(h);
        // Screenshots are physical pixels, cropped to the visible desktop.
        r.Left=Math.Max(r.Left,GetSystemMetrics(76)); r.Top=Math.Max(r.Top,GetSystemMetrics(77));
        r.Right=Math.Min(r.Right,GetSystemMetrics(76)+GetSystemMetrics(78));
        r.Bottom=Math.Min(r.Bottom,GetSystemMetrics(77)+GetSystemMetrics(79));
        FrameId=Guid.NewGuid().ToString("N"); FrameWindow=h.ToInt64(); FrameProcess=Convert.ToInt32(request["processId"]);
        FrameInput=InputTick(); FrameBounds=r; FrameAt=Stopwatch.GetTimestamp();
        return Map("frameId",FrameId,"window",Window(h),"x",r.Left,"y",r.Top,"width",r.Right-r.Left,"height",r.Bottom-r.Top,
            "lastInputTick",FrameInput,"inputChangedDuringRead",false);
    }
    static object Capture(Dictionary<string, object> request) {
        var result=Frame(request); var r=FrameBounds; uint input=FrameInput;
        using(var bitmap=new Bitmap(r.Right-r.Left,r.Bottom-r.Top)) {
            using(var g=Graphics.FromImage(bitmap)) g.CopyFromScreen(r.Left,r.Top,0,0,bitmap.Size);
            using(var stream=new MemoryStream()) {
                bitmap.Save(stream,ImageFormat.Png);
                result["mimeType"]="image/png";result["data"]=Convert.ToBase64String(stream.ToArray());
                result["inputChangedDuringRead"]=input!=InputTick();
                return result;
            }
        }
    }
    static object Sequence(Dictionary<string, object> request) {
        InputAllowed(); ValidateWindow(request);
        if(request.ContainsKey("expectedInputTick")&&Convert.ToUInt32(request["expectedInputTick"])!=InputTick())
            throw new HostFault("USER_INTERFERENCE","Input changed since the preceding scripted operation");
        var actions=Get(request,"actions",null) as System.Collections.ArrayList;
        if(actions==null||actions.Count<1||actions.Count>128) throw new HostFault("INVALID_SEQUENCE","1..128 actions required");
        foreach(var raw in actions) {
            var action=raw as Dictionary<string,object>;
            if(action==null)throw new HostFault("INVALID_SEQUENCE","Invalid action");
            string op=Text(action,"operation","");
            if(!new System.Collections.Generic.HashSet<string>{"key","type","paste","click","wheel","move","drag"}.Contains(op))
                throw new HostFault("INVALID_SEQUENCE","Unsupported action");
            if(op=="key") {
                var keys=Get(action,"keys",null) as System.Collections.ArrayList;
                if(keys==null||keys.Count<1||keys.Count>8)throw new HostFault("INVALID_KEY","Invalid chord");
                foreach(var key in keys)Vk(Convert.ToString(key));
            }
            if((op=="type"||op=="paste")&&Text(action,"text","").Length>100000)throw new HostFault("INVALID_VALUE","Text too long");
        }
        uint tick=InputTick();int completed=0;
        foreach(Dictionary<string,object> action in actions) {
            if(InputTick()!=tick)throw new HostFault("USER_INTERFERENCE","Input changed between scripted actions");
            var frame=Frame(request);
            var parameters=new Dictionary<string,object>(action);
            parameters["windowId"]=request["windowId"];parameters["processId"]=request["processId"];parameters["frameId"]=frame["frameId"];
            Desktop(parameters); tick=OwnedInput;completed++;
        }
        return Map("performed",true,"actions",completed,"lastInputTick",tick);
    }
    static INPUT Key(ushort vk, bool up) { return new INPUT { Type=1, Data=new INPUTUNION { Key=new KEY { Vk=vk, Flags=up?2u:0u, Extra=new UIntPtr(0x4d655379) } } }; }
    static INPUT Mouse(int x,int y,uint flags,uint data) { return new INPUT { Type=0, Data=new INPUTUNION { Mouse=new MOUSE { X=x,Y=y,Flags=flags,Data=data,Extra=new UIntPtr(0x4d655379) } } }; }
    static void Send(params INPUT[] inputs) {
        InputAllowed();
        uint sent=SendInput((uint)inputs.Length,inputs,Marshal.SizeOf(typeof(INPUT)));
        if(sent>0) InputWasDelivered=true;
        if (sent != inputs.Length)
            throw new HostFault("INPUT_FAILED", "Input delivery incomplete (possibly integrity-level isolation)");
    }
    static ushort Vk(string key) {
        var keys=new Dictionary<string,ushort>(StringComparer.OrdinalIgnoreCase) {
            {"CTRL",17},{"CONTROL",17},{"ALT",18},{"SHIFT",16},{"WIN",91},{"ENTER",13},{"RETURN",13},{"TAB",9},
            {"ESC",27},{"ESCAPE",27},{"BACKSPACE",8},{"DELETE",46},{"SPACE",32},{"HOME",36},{"END",35},
            {"PAGEUP",33},{"PAGEDOWN",34},{"LEFT",37},{"UP",38},{"RIGHT",39},{"DOWN",40},{"INSERT",45} };
        ushort value;
        if(keys.TryGetValue(key,out value)) return value;
        if(key.Length==1 && Char.IsLetterOrDigit(key[0]) && key[0]<128) return (ushort)Char.ToUpperInvariant(key[0]);
        int n; if(key.StartsWith("F",StringComparison.OrdinalIgnoreCase)&&Int32.TryParse(key.Substring(1),out n)&&n>=1&&n<=24) return (ushort)(111+n);
        throw new HostFault("INVALID_KEY", "Unknown key name");
    }
    static void MoveTo(IntPtr h,int x,int y) {
        if(x<0||y<0||x>=FrameBounds.Right-FrameBounds.Left||y>=FrameBounds.Bottom-FrameBounds.Top)
            throw new HostFault("INVALID_POINT", "Coordinates must be inside observed frame");
        var p=new POINT(FrameBounds.Left+x,FrameBounds.Top+y);
        if(GetAncestor(WindowFromPoint(p),2)!=h) throw new HostFault("OCCLUDED_TARGET", "Another window covers the target point");
        int left=GetSystemMetrics(76),top=GetSystemMetrics(77),width=GetSystemMetrics(78),height=GetSystemMetrics(79);
        Send(Mouse((p.X-left)*65535/(width-1),(p.Y-top)*65535/(height-1),0xc001,0));
    }
    static object Desktop(Dictionary<string, object> request) {
        InputAllowed(); var h=ValidateWindow(request); string op=Text(request,"operation","");
        if(op=="activate") {
            uint tick=InputTick();
            if(IsIconic(h)) ShowWindow(h,9);
            if(GetForegroundWindow()!=h) {
                if(!SetForegroundWindow(h)) {
                    if(InputTick()!=tick) throw new HostFault("USER_INTERFERENCE","Input changed during activation");
                    Send(Key(18,false),Key(18,true)); SetForegroundWindow(h);
                }
                Thread.Sleep(100);
            }
            if(GetForegroundWindow()!=h) throw new HostFault("ACTIVATION_DENIED","Windows denied foreground activation");
            Elements.Clear(); FrameId=null;
            return Map("performed",true,"window",Window(h),"lastInputTick",AcknowledgeInput());
        }
        if(GetForegroundWindow()!=h) throw new HostFault("USER_INTERFERENCE","Target lost foreground");
        if(Text(request,"frameId","")!=FrameId || FrameId==null || FrameWindow!=h.ToInt64() || FrameProcess!=Convert.ToInt32(request["processId"]) ||
            (Stopwatch.GetTimestamp()-FrameAt)/(double)Stopwatch.Frequency>30)
            throw new HostFault("STALE_FRAME","Capture a fresh frame before input");
        if(InputTick()!=FrameInput) throw new HostFault("USER_INTERFERENCE","Input occurred after capture");
        var r=Bounds(h);
        // Check visible dimensions and position against the crop too.
        if(Math.Max(r.Left,GetSystemMetrics(76))!=FrameBounds.Left || Math.Max(r.Top,GetSystemMetrics(77))!=FrameBounds.Top ||
            Math.Min(r.Right,GetSystemMetrics(76)+GetSystemMetrics(78))!=FrameBounds.Right || Math.Min(r.Bottom,GetSystemMetrics(77)+GetSystemMetrics(79))!=FrameBounds.Bottom)
            throw new HostFault("STALE_FRAME","Window moved or resized");
        if(!new HashSet<string>{"click","move","drag","wheel","key","type","paste","close_window","clipboard_read"}.Contains(op))
            throw new HostFault("INVALID_ACTION","Unknown desktop operation");
        // Validate all parameters before consuming the observation.
        ushort[] chord=null; string text=null; int x=0,y=0,dx=0,dy=0,amount=0; uint down=2,up=4;
        if(op=="key") {
            var raw=Get(request,"keys",null) as System.Collections.ArrayList;
            if(raw==null||raw.Count<1||raw.Count>8) throw new HostFault("INVALID_KEY","keys must be an array of 1..8 names");
            chord=new ushort[raw.Count]; for(int i=0;i<raw.Count;i++) chord[i]=Vk(Convert.ToString(raw[i]));
        }
        if(op=="type"||op=="paste") {
            if(System.Windows.Automation.AutomationElement.FocusedElement.Current.IsPassword)
                throw new HostFault("PASSWORD_FIELD","Use the authorized credential operation for password fields");
            text=Text(request,"text",""); if(text.Length>100000) throw new HostFault("INVALID_VALUE","Text too long");
        }
        if(op=="click"||op=="move"||op=="drag"||op=="wheel") {
            x=Number(request,"x",-1,0,FrameBounds.Right-FrameBounds.Left-1); y=Number(request,"y",-1,0,FrameBounds.Bottom-FrameBounds.Top-1);
        }
        if(op=="drag") { dx=Number(request,"toX",-1,0,FrameBounds.Right-FrameBounds.Left-1); dy=Number(request,"toY",-1,0,FrameBounds.Bottom-FrameBounds.Top-1); }
        if(op=="wheel") amount=Number(request,"delta",0,-12000,12000);
        if(op=="click") {
            string button=Text(request,"button","left");
            if(button=="right") {down=8;up=16;} else if(button=="middle") {down=32;up=64;} else if(button!="left") throw new HostFault("INVALID_ACTION","Unknown mouse button");
        }
        FrameId=null; Elements.Clear(); Descriptions.Clear();
        if(op=="close_window") { InputWasDelivered=true; PostMessage(h,0x10,IntPtr.Zero,IntPtr.Zero); }
        else if(op=="key") {
            var inputs=new List<INPUT>(); foreach(var key in chord) inputs.Add(Key(key,false));
            for(int i=chord.Length-1;i>=0;i--) inputs.Add(Key(chord[i],true)); Send(inputs.ToArray());
        } else if(op=="type") {
            // UTF-16 code units preserve surrogate pairs without clipboard use.
            for(int start=0;start<text.Length;start+=128) {
                if(GetForegroundWindow()!=h) throw new HostFault("USER_INTERFERENCE","Target lost foreground during typing");
                var inputs=new List<INPUT>();
                for(int i=start;i<Math.Min(start+128,text.Length);i++) {
                    inputs.Add(new INPUT{Type=1,Data=new INPUTUNION{Key=new KEY{Scan=text[i],Flags=4,Extra=new UIntPtr(0x4d655379)}}});
                    inputs.Add(new INPUT{Type=1,Data=new INPUTUNION{Key=new KEY{Scan=text[i],Flags=6,Extra=new UIntPtr(0x4d655379)}}});
                } Send(inputs.ToArray());
            }
        } else if(op=="paste") {
            Exception error=null;
            var thread=new Thread(delegate(){try {
                if(text.Length==0)System.Windows.Forms.Clipboard.Clear();
                else System.Windows.Forms.Clipboard.SetText(text);
            }catch(Exception e){error=e;}});
            thread.SetApartmentState(ApartmentState.STA);thread.Start();thread.Join();
            if(error!=null)throw new HostFault("CLIPBOARD_UNAVAILABLE","Clipboard is busy");
            Send(Key(17,false),Key(86,false),Key(86,true),Key(17,true));
        } else if(op=="clipboard_read") {
            string content=null; Exception error=null;
            var thread=new Thread(delegate(){try {content=System.Windows.Forms.Clipboard.GetText();}catch(Exception e){error=e;}});
            thread.SetApartmentState(ApartmentState.STA); thread.Start(); thread.Join();
            if(error!=null) throw new HostFault("CLIPBOARD_UNAVAILABLE","Clipboard is busy");
            return Map("text",content,"lastInputTick",InputTick());
        } else {
            MoveTo(h,x,y);
            if(op=="click") {
                int count=Number(request,"count",1,1,2);
                for(int i=0;i<count;i++) {Send(Mouse(0,0,down,0),Mouse(0,0,up,0));if(count>1)Thread.Sleep(70);}
            } else if(op=="wheel") Send(Mouse(0,0,0x800,unchecked((uint)amount)));
            else if(op=="drag") {
                Send(Mouse(0,0,2,0));
                try { for(int i=1;i<=12;i++){MoveTo(h,x+(dx-x)*i/12,y+(dy-y)*i/12);Thread.Sleep(15);} }
                finally {Send(Mouse(0,0,4,0));}
            }
        }
        Thread.Sleep(50);
        return Map("performed",true,"operation",op,"lastInputTick",AcknowledgeInput());
    }
}
