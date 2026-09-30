use std::fs;
use std::path::PathBuf;
use std::process::Command;

use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    Manager, WebviewUrl, WebviewWindowBuilder,
};

/// Resolve the user's data root. Mirrors scripts/lib/paths.js fallback:
/// $VIBESTATS_DATA_DIR > repo root (when running from a clone with pricing.json) > ~/.vibestats
///
/// The repo-root branch matters for `tauri dev` / `cargo run` from a checkout:
/// without it, Rust would read/write aliases under ~/.vibestats while the Node
/// CLI happily uses the repo's project-aliases.json, and edits made in the
/// grouping editor would never reach the snapshot/build pipeline.
fn data_root() -> PathBuf {
    if let Ok(p) = std::env::var("VIBESTATS_DATA_DIR") {
        return PathBuf::from(p);
    }
    if let Some(repo_root) = PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent() {
        if repo_root.join("pricing.json").exists() {
            return repo_root.to_path_buf();
        }
    }
    dirs::home_dir()
        .map(|h| h.join(".vibestats"))
        .unwrap_or_else(|| PathBuf::from(".vibestats"))
}

fn pricing_path() -> PathBuf {
    data_root().join("pricing.json")
}

fn aliases_path() -> PathBuf {
    data_root().join("project-aliases.json")
}

/// Path to the bundled CLI entry point. Tries the bundled resource
/// dir first (release builds where bin/ + scripts/ are copied next to
/// the binary), then falls back to the compile-time repo root (dev mode
/// — resource_dir() points at target/debug/ where no resources live).
fn cli_path(handle: &tauri::AppHandle) -> Option<PathBuf> {
    let bundled = handle
        .path()
        .resource_dir()
        .ok()
        .map(|r| r.join("bin").join("cli.js"));
    if let Some(ref p) = bundled {
        if p.exists() {
            return bundled;
        }
    }
    // Dev fallback. CARGO_MANIFEST_DIR is set at compile time to src-tauri/.
    let dev_repo = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|p| p.join("bin").join("cli.js"));
    if let Some(ref p) = dev_repo {
        if p.exists() {
            return dev_repo;
        }
    }
    bundled
}

#[tauri::command]
fn dashboard_path() -> String {
    data_root()
        .join("combined-dashboard.html")
        .to_string_lossy()
        .into_owned()
}

/// Run `vibestats <subcommands>` against our data_root.
///
/// Forcing VIBESTATS_DATA_DIR matters because the CLI's own resolver would pick
/// the repo dir when pricing.json exists there (dev mode), and the file:// link
/// in dashboard_path would then 404.
///
/// `live` reads ~/.claude, ~/.codex, ~/.gemini in place instead of the newest
/// snapshot — seconds rather than a ~2GB rsync, which is what makes it usable
/// on every launch.
fn run_cli(handle: &tauri::AppHandle, subs: &[&str], live: bool) -> Result<String, String> {
    let cli = cli_path(handle).ok_or("CLI path unresolved")?;
    if !cli.exists() {
        return Err(format!("CLI not found at {}", cli.display()));
    }
    let data_dir = data_root();
    let mut out = String::new();
    for sub in subs {
        let mut cmd = Command::new("node");
        cmd.arg(&cli)
            .arg(sub)
            .env("VIBESTATS_DATA_DIR", &data_dir);
        if live {
            cmd.env("VIBESTATS_LIVE", "1");
        }
        let res = cmd.output().map_err(|e| format!("spawn {sub}: {e}"))?;
        out.push_str(&format!("=== {sub}{} ===\n", if live { " (live)" } else { "" }));
        out.push_str(&String::from_utf8_lossy(&res.stdout));
        out.push_str(&String::from_utf8_lossy(&res.stderr));
        if !res.status.success() {
            return Err(out);
        }
    }
    Ok(out)
}

/// Fast path, used on launch and by the Refresh button: rebuild from the live
/// dirs. No snapshot, so the dashboard reflects sessions from minutes ago.
#[tauri::command]
fn prepare_dashboard(handle: tauri::AppHandle) -> Result<String, String> {
    run_cli(&handle, &["build"], true)
}

/// Full path: take a dated snapshot first, then rebuild from it. Slower (copies
/// the transcript dirs) but it is what preserves history and what `redact`
/// operates on.
#[tauri::command]
fn snapshot_and_rebuild(handle: tauri::AppHandle) -> Result<String, String> {
    run_cli(&handle, &["snapshot", "build"], false)
}

#[tauri::command]
fn focus_main(handle: tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = handle.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
    Ok(())
}

#[tauri::command]
fn read_config() -> Result<String, String> {
    let p = pricing_path();
    fs::read_to_string(&p).map_err(|e| format!("read {}: {}", p.display(), e))
}

#[tauri::command]
fn write_config(contents: String) -> Result<(), String> {
    // Validate parseable before touching disk so a typo can't corrupt pricing.json.
    serde_json::from_str::<serde_json::Value>(&contents)
        .map_err(|e| format!("invalid JSON: {e}"))?;
    let p = pricing_path();
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir {}: {}", parent.display(), e))?;
    }
    fs::write(&p, contents).map_err(|e| format!("write {}: {}", p.display(), e))?;
    // Match the 0600 perms scripts/lib/paths.js sets — pricing.json sits next to
    // transcript snapshots that may contain pasted secrets.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&p, fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

#[tauri::command]
fn read_aliases() -> Result<String, String> {
    let p = aliases_path();
    if !p.exists() {
        return Ok("{\"aliases\":{}}".into());
    }
    fs::read_to_string(&p).map_err(|e| format!("read {}: {}", p.display(), e))
}

#[tauri::command]
fn write_aliases(contents: String) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(&contents)
        .map_err(|e| format!("invalid JSON: {e}"))?;
    let p = aliases_path();
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir {}: {}", parent.display(), e))?;
    }
    fs::write(&p, contents).map_err(|e| format!("write {}: {}", p.display(), e))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&p, fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

#[tauri::command]
fn open_settings(handle: tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = handle.get_webview_window("settings") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
        return Ok(());
    }
    WebviewWindowBuilder::new(&handle, "settings", WebviewUrl::App("settings.html".into()))
        .title("Vibestats — Settings")
        .inner_size(640.0, 620.0)
        .min_inner_size(480.0, 480.0)
        .resizable(true)
        .center()
        .build()
        .map_err(|e| format!("build settings window: {e}"))?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let handle = app.handle().clone();

            // System tray with Open / Settings / Refresh (live) / Snapshot / Quit
            let open_item = MenuItem::with_id(app, "open", "Open Dashboard", true, None::<&str>)?;
            let settings_item =
                MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
            let refresh_item =
                MenuItem::with_id(app, "refresh", "Refresh Now", true, None::<&str>)?;
            let snapshot_item = MenuItem::with_id(
                app,
                "snapshot",
                "Snapshot + Rebuild…",
                true,
                None::<&str>,
            )?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(
                app,
                &[
                    &open_item,
                    &settings_item,
                    &refresh_item,
                    &snapshot_item,
                    &quit_item,
                ],
            )?;

            let icon = Image::from_bytes(include_bytes!("../icons/32x32.png"))?;
            let _tray = TrayIconBuilder::with_id("main")
                .icon(icon)
                .menu(&menu)
                .on_menu_event({
                    let h = handle.clone();
                    move |app_handle, event| match event.id.as_ref() {
                        "open" => {
                            let _ = focus_main(app_handle.clone());
                        }
                        "settings" => {
                            let _ = open_settings(app_handle.clone());
                        }
                        "refresh" => {
                            let h2 = h.clone();
                            std::thread::spawn(move || {
                                let _ = prepare_dashboard(h2);
                            });
                        }
                        "snapshot" => {
                            let h2 = h.clone();
                            std::thread::spawn(move || {
                                let _ = snapshot_and_rebuild(h2);
                            });
                        }
                        "quit" => {
                            app_handle.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        ..
                    } = event
                    {
                        let _ = focus_main(tray.app_handle().clone());
                    }
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            dashboard_path,
            prepare_dashboard,
            snapshot_and_rebuild,
            focus_main,
            read_config,
            write_config,
            read_aliases,
            write_aliases,
            open_settings
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
