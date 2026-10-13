use std::{env, fs};
use zed_extension_api::{self as zed, LanguageServerId, Result, serde_json::json, settings::LspSettings};

// Packaged extensions only ship extension.wasm (+ themes/grammars/…).
// Work dir is extensions/work/<id> — materialize the Node LSP there (same idea as
// zed/extensions/html downloading into work dir).
// Docs: https://github.com/zed-industries/zed/blob/main/docs/src/extensions/developing-extensions.md
const SERVER_PATH: &str = "server/server.mjs";
const SERVER_JS: &str = include_str!("../server/server.mjs");

struct HtmlCssSupportExtension {
    cached_server_path: Option<String>,
}

impl HtmlCssSupportExtension {
    fn server_exists(&self) -> bool {
        fs::metadata(SERVER_PATH).is_ok_and(|stat| stat.is_file())
    }

    fn server_script_path(&mut self, language_server_id: &LanguageServerId) -> Result<String> {
        if self.cached_server_path.is_some() && self.server_exists() {
            return Ok(SERVER_PATH.to_string());
        }

        zed::set_language_server_installation_status(
            language_server_id,
            &zed::LanguageServerInstallationStatus::CheckingForUpdate,
        );

        let needs_write = match fs::read_to_string(SERVER_PATH) {
            Ok(existing) => existing != SERVER_JS,
            Err(_) => true,
        };

        if needs_write {
            zed::set_language_server_installation_status(
                language_server_id,
                &zed::LanguageServerInstallationStatus::Downloading,
            );
            if let Some(parent) = std::path::Path::new(SERVER_PATH).parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            fs::write(SERVER_PATH, SERVER_JS).map_err(|e| e.to_string())?;
        }

        Ok(SERVER_PATH.to_string())
    }
}

impl zed::Extension for HtmlCssSupportExtension {
    fn new() -> Self {
        Self {
            cached_server_path: None,
        }
    }

    fn language_server_command(
        &mut self,
        language_server_id: &LanguageServerId,
        _worktree: &zed::Worktree,
    ) -> Result<zed::Command> {
        let server_path = self.server_script_path(language_server_id)?;
        let server_path = env::current_dir()
            .map_err(|e| e.to_string())?
            .join(&server_path)
            .to_string_lossy()
            .to_string();
        self.cached_server_path = Some(server_path.clone());

        Ok(zed::Command {
            command: zed::node_binary_path()?,
            args: vec![server_path, "--stdio".to_string()],
            env: Default::default(),
        })
    }

    fn language_server_workspace_configuration(
        &mut self,
        server_id: &LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<Option<zed::serde_json::Value>> {
        let user = LspSettings::for_worktree(server_id.as_ref(), worktree)
            .ok()
            .and_then(|s| s.settings);
        let mut base = json!({
            "styleSheets": ["**/*.css", "**/*.scss", "**/*.less"]
        });
        if let Some(zed::serde_json::Value::Object(map)) = user {
            if let Some(obj) = base.as_object_mut() {
                for (k, v) in map {
                    obj.insert(k, v);
                }
            }
        }
        Ok(Some(base))
    }

    fn language_server_initialization_options(
        &mut self,
        _server_id: &LanguageServerId,
        _worktree: &zed::Worktree,
    ) -> Result<Option<zed::serde_json::Value>> {
        Ok(Some(json!({
            "styleSheets": ["**/*.css", "**/*.scss", "**/*.less"]
        })))
    }
}

zed::register_extension!(HtmlCssSupportExtension);
