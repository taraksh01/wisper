import Gio from 'gi://Gio';

const IFACE = `
<node>
   <interface name="org.gnome.Shell.Extensions.WisperWindows">
      <method name="List">
         <arg type="s" direction="out" name="win" />
      </method>
      <method name="Activate">
         <arg type="u" direction="in" name="winid" />
      </method>
   </interface>
</node>`;

export default class Extension {
  enable() {
    this._dbus = Gio.DBusExportedObject.wrapJSObject(IFACE, this);
    this._dbus.export(Gio.DBus.session, '/org/gnome/Shell/Extensions/WisperWindows');
  }
  disable() {
    this._dbus.flush();
    this._dbus.unexport();
    delete this._dbus;
  }
  _get_window_by_wid(winid) {
    const actors = global.get_window_actors?.() ?? [];
    return actors.find(w => w.meta_window.get_id() == winid);
  }
  List() {
    const actors = global.get_window_actors?.() ?? [];
    const arr = actors.map(w => {
      const mw = w.meta_window;
      let focus = false;
      try { focus = !!mw.has_focus?.(); } catch {}
      let wm_class = "";
      try { wm_class = mw.get_wm_class?.() ?? ""; } catch {}
      let wm_class_instance = "";
      try { wm_class_instance = mw.get_wm_class_instance?.() ?? ""; } catch {}
      let title = "";
      try { title = mw.get_title?.() ?? ""; } catch {}
      let pid = 0;
      try { pid = mw.get_pid?.() ?? 0; } catch {}
      let id = 0;
      try { id = mw.get_id?.() ?? 0; } catch {}
      return { id, wm_class, wm_class_instance, title, pid, focus };
    });
    return JSON.stringify(arr);
  }
  Activate(winid) {
    const w = this._get_window_by_wid(winid);
    if (!w) throw new Error('Not found');
    const mw = w.meta_window;
    const ws = mw.get_workspace?.();
    if (ws?.activate_with_focus) {
      ws.activate_with_focus(mw, global.get_current_time?.() ?? 0);
    } else {
      mw.activate?.(global.get_current_time?.() ?? 0);
    }
  }
}
