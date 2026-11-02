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
    static readonly Dictionary<string,object> AdminRequests=new Dictionary<string,object>();
    static string QuoteArgument(string value) {
        var b=new StringBuilder("\""); int slashes=0;
        foreach(char c in value) {
            if(c=='\\') {slashes++;continue;}
            if(c=='\"') b.Append('\\',slashes*2+1); else b.Append('\\',slashes);
            b.Append(c); slashes=0;
        }
        b.Append('\\',slashes*2); return b.Append('"').ToString();
    }
    static object AdminLaunch(Dictionary<string,object> request) {
        InputAllowed(); string executable=Text(request,"executable","");
        if(!Path.IsPathRooted(executable) || !File.Exists(executable)) throw new HostFault("INVALID_EXECUTABLE","Existing absolute executable required");
        if(Restricted(Path.GetFileNameWithoutExtension(executable))) throw new HostFault("RESTRICTED_APP","Application is outside scope");
        var args=Get(request,"args",new ArrayList()) as ArrayList;
        if(args==null || args.Count>128) throw new HostFault("INVALID_ARGUMENT","Argument array required");
        var quoted=new List<string>(); foreach(object argument in args) {
            if(!(argument is string) || ((string)argument).IndexOf('\0')>=0) throw new HostFault("INVALID_ARGUMENT","Invalid argument");
            quoted.Add(QuoteArgument((string)argument));
        }
        string id=Guid.NewGuid().ToString("N");
        lock(AdminRequests) {
            if(AdminRequests.Count>=64) throw new HostFault("ADMIN_REQUEST_LIMIT","Restart the idle bridge to clear old requests");
            AdminRequests[id]=Map("id",id,"status","pending_os_consent","retryAllowed",false);
        }
        var thread=new Thread(delegate() {
            object result;
            try {
                using(var process=Process.Start(new ProcessStartInfo{FileName=executable,Arguments=String.Join(" ",quoted.ToArray()),UseShellExecute=true,Verb="runas"}))
                    result=Map("id",id,"status","os_launch_accepted","processId",process==null?0:process.Id,"taskStatus","unverified");
            } catch(System.ComponentModel.Win32Exception e) {
                result=Map("id",id,"status",e.NativeErrorCode==1223?"cancelled":"failed","reason","OS_ERROR_"+e.NativeErrorCode,"retryAllowed",false);
            } catch {result=Map("id",id,"status","unknown","retryAllowed",false);}
            lock(AdminRequests) AdminRequests[id]=result;
        });
        thread.IsBackground=true; thread.SetApartmentState(ApartmentState.STA); thread.Start();
        return Map("id",id,"status","pending_os_consent","retryAllowed",false);
    }
    static object AdminStatus(Dictionary<string,object> request) {
        lock(AdminRequests) {
            object result;
            if(!AdminRequests.TryGetValue(Text(request,"ticket",""),out result)) throw new HostFault("ADMIN_REQUEST_UNKNOWN","No receipt in this bridge; do not retry launch blindly");
            return result;
        }
    }

}
