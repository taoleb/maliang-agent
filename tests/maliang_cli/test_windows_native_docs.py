from pathlib import Path


def test_windows_native_install_path_docs_match_installer() -> None:
    doc = Path("website/docs/user-guide/windows-native.md").read_text()
    install = Path("scripts/install.ps1").read_text()

    assert "%LOCALAPPDATA%\\maliang\\maliang-agent\\venv\\Scripts" in doc
    assert "Get-Command maliang        # should print C:\\Users\\<you>\\AppData\\Local\\maliang\\maliang-agent\\venv\\Scripts\\maliang.exe" in doc
    assert '$maliangBin = "$InstallDir\\venv\\Scripts"' in install
