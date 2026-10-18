//! XamVerse desktop application entry point.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    xamverse_shell::run();
}
