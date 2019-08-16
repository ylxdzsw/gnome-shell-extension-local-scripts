const { Gtk, GLib, GObject, Gio, St } = imports.gi
const Mainloop = imports.mainloop

const Main = imports.ui.main
const PanelMenu = imports.ui.panelMenu
const PopupMenu = imports.ui.popupMenu
const Message = imports.ui.messageTray

const Me = imports.misc.extensionUtils.getCurrentExtension()

const app = {
    exec(args, timeout=30000) {
        let [_, pid, stdinFd, stdoutFd, stderrFd] =
            GLib.spawn_async_with_pipes(null, args, null, GLib.SpawnFlags.DO_NOT_REAP_CHILD | GLib.SpawnFlags.SEARCH_PATH, null)

        let stdout = new Gio.UnixInputStream({ fd: stdoutFd, close_fd: true })
        let outReader = new Gio.DataInputStream({ base_stream: stdout })

        let stderr = new Gio.UnixInputStream({ fd: stderrFd, close_fd: true })
        let errReader = new Gio.DataInputStream({ base_stream: stderr })

        GLib.close(stdinFd)

        return new Promise((resolve, reject) => {
            const cw = GLib.child_watch_add(GLib.PRIORITY_DEFAULT, pid, () => {
                try {
                    const [out, err] = [[], []]
                    let line = null

                    while (([line] = outReader.read_line(null)) != null && line != null) if (line)
                        out.push('' + line)
                    stdout.close(null)

                    while (([line] = errReader.read_line(null)) != null && line != null) if (line)
                        err.push('' + line)
                    stderr.close(null)

                    GLib.source_remove(cw)
                    global.log("resolved:" + JSON.stringify(args))
                    resolve([out, err])
                } catch (e) {
                    reject(e)
                }
            })
            Mainloop.timeout_add(timeout, () => reject(new Error(`${args} timeout in ${timeout}ms`)))
        })
    },

    exec_detach(args) {
        let [_, pid] = GLib.spawn_async(null, args, null, GLib.SpawnFlags.DO_NOT_REAP_CHILD | GLib.SpawnFlags.SEARCH_PATH, null)
        return pid == 0 ? Promise.reject() : Promise.resolve(pid)
    },

    notify(title, content, pop=true) {
        return new Promise((resolve, reject) => {
            try {
                const source = new Message.Source("GS-extension-local-scripts", "open-menu-symbolic")
                Main.messageTray.add(source)
                const notification = new Message.Notification(source, title, content)
                notification.connect('activated', resolve)
                pop ? source.notify(notification) : source.pushNotification(notification)
            } catch (e) {
                reject(e)
            }
        })
    },

    create_button() {
        let button = new PanelMenu.Button(null)
        let hbox = new St.BoxLayout() // box is necessary for highlighting when active
        let icon = new St.Icon({ icon_name: 'open-menu-symbolic', style_class: 'system-status-icon' })
        hbox.add_child(icon)
        button.actor.add_actor(hbox)
        button.actor.add_style_class_name('panel-status-button')
        button.actor.connect('button-press-event', () => this.update_menu())
        Main.panel.addToStatusArea('local-scripts-manager', button)

        return button
    },

    async update_menu() {
        const menu = this.panel_button.menu
        menu.removeAll()

        const scripts = await this.exec(['ls', '/usr/local/bin']).then(([out, err]) => out)

        for (const script of scripts)
            menu.addMenuItem((() => {
                const item = new PopupMenu.PopupMenuItem(script)
                item.connect("activate", () => this.exec_detach([script]))
                return item
            })())
    }
}

// API: build the entry button
function enable() {
    app.panel_button = app.create_button()
    app.update_menu()
}

// API: destroy the entry button
function disable() {
    app.panel_button.destroy()
}
