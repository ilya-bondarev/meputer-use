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
    static Mutex WorkflowMutex;
    static object AcquireInputLease() {
        InputAllowed();
        if(WorkflowMutex!=null) throw new HostFault("INPUT_BUSY","An input lease is already active in this bridge");
        var mutex=new Mutex(false,"Local\\MeSystemWindowsExecutorInput");
        try {
            try {if(!mutex.WaitOne(0)) throw new HostFault("INPUT_BUSY","Another executor owns the desktop");}
            catch(AbandonedMutexException) { }
            WorkflowMutex=mutex; return Map("acquired",true);
        } catch {mutex.Dispose();throw;}
    }
    static object ReleaseInputLease() {
        if(WorkflowMutex!=null) {WorkflowMutex.ReleaseMutex();WorkflowMutex.Dispose();WorkflowMutex=null;}
        return Map("released",true);
    }

}
