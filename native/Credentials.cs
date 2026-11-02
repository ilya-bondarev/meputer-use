using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Automation;

static partial class WindowsUiaHost {
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct CREDENTIAL {
        public uint Flags, Type; public string TargetName, Comment; public long LastWritten;
        public uint CredentialBlobSize; public IntPtr CredentialBlob; public uint Persist, AttributeCount;
        public IntPtr Attributes; public string TargetAlias, UserName;
    }
    [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern bool CredRead(string target, uint type, uint flags, out IntPtr credential);
    [DllImport("advapi32.dll")] static extern void CredFree(IntPtr credential);
    static object FillSecret(Dictionary<string, object> request) {
        InputAllowed(); var handle=ValidateWindow(request);
        if(handle.ToInt64()!=BoundWindow || Convert.ToInt32(request["processId"])!=BoundProcess ||
            GetForegroundWindow()!=handle || InputTick()!=ObservedInput)
            throw new HostFault("USER_INTERFERENCE","Target changed before credential delivery");
        AutomationElement element;
        if(!Elements.TryGetValue(Text(request,"ref",""),out element) ||
            (Stopwatch.GetTimestamp()-SnapshotCompletedAt)/(double)Stopwatch.Frequency>2)
            throw new HostFault("STALE_SNAPSHOT","Fresh credential field required");
        var current=element.Current;
        if(!current.IsEnabled || current.IsOffscreen || current.ControlType!=ControlType.Edit)
            throw new HostFault("NOT_ACTIONABLE","Credential field must be a visible editable control");
        var previous=Descriptions[Text(request,"ref","")];
        if(current.Name!=Convert.ToString(previous["name"]) || current.AutomationId!=Convert.ToString(previous["automationId"]))
            throw new HostFault("STALE_SNAPSHOT","Credential field identity changed");
        string value=null; IntPtr credential=IntPtr.Zero;
        try {
            string target=Text(request,"credentialTarget","");
            if(target.Length>0) {
                if(!CredRead(target,1,0,out credential)) throw new HostFault("SECRET_UNAVAILABLE","Credential not found");
                var stored=(CREDENTIAL)Marshal.PtrToStructure(credential,typeof(CREDENTIAL));
                if(stored.CredentialBlobSize>32768 || stored.CredentialBlobSize%2!=0)
                    throw new HostFault("SECRET_FORMAT","Expected a UTF-16 generic credential");
                value=Marshal.PtrToStringUni(stored.CredentialBlob,(int)stored.CredentialBlobSize/2);
            } else value=Text(request,"value","");
            if(String.IsNullOrEmpty(value) || value.Length>16384) throw new HostFault("SECRET_UNAVAILABLE","Credential value unavailable");
            if(GetForegroundWindow()!=handle || InputTick()!=ObservedInput) throw new HostFault("USER_INTERFERENCE","Target changed");
            Elements.Clear(); Descriptions.Clear(); FrameId=null;
            element.SetFocus();
            if(AutomationElement.FocusedElement.Current.ProcessId!=BoundProcess) throw new HostFault("USER_INTERFERENCE","Credential field lost focus");
            object pattern;
            if(!current.IsPassword && element.TryGetCurrentPattern(ValuePattern.Pattern,out pattern) && !((ValuePattern)pattern).Current.IsReadOnly)
                ((ValuePattern)pattern).SetValue(value);
            else {
                Send(Key(17,false),Key(65,false),Key(65,true),Key(17,true));
                for(int start=0;start<value.Length;start+=128) {
                    if(GetForegroundWindow()!=handle || !AutomationElement.FocusedElement.Equals(element))
                        throw new HostFault("ACTION_INTERRUPTED","Credential field lost focus");
                    var inputs=new List<INPUT>();
                    for(int i=start;i<Math.Min(start+128,value.Length);i++) {
                        inputs.Add(new INPUT{Type=1,Data=new INPUTUNION{Key=new KEY{Scan=value[i],Flags=4}}});
                        inputs.Add(new INPUT{Type=1,Data=new INPUTUNION{Key=new KEY{Scan=value[i],Flags=6}}});
                    }
                    Send(inputs.ToArray());
                }
            }
            return Map("delivered",true,"taskStatus","unverified","lastInputTick",AcknowledgeInput());
        } finally { value=null; if(credential!=IntPtr.Zero) CredFree(credential); }
    }

}
