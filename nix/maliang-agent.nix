# nix/maliang-agent.nix — Overridable Maliang Agent package
#
# callPackage auto-wires nixpkgs args; flake inputs are passed explicitly.
# Users override via:
#   pkgs.maliang-agent.override { extraPythonPackages = [...]; }
#   pkgs.maliang-agent.override { extraDependencyGroups = [ "hindsight" ]; }
{
  lib,
  stdenv,
  makeWrapper,
  callPackage,
  python312,
  nodejs_22,
  electron,
  ripgrep,
  git,
  openssh,
  ffmpeg,
  tirith,

  # linux-only deps
  wl-clipboard,
  xclip,

  # Flake inputs — passed explicitly by packages.nix and overlays.nix
  uv2nix,
  pyproject-nix,
  pyproject-build-systems,
  npm-lockfile-fix,
  # Locked git revision of the flake source — embedded so banner.py can
  # check for updates without needing a local .git directory. Null for
  # impure / dirty builds where flakes can't determine a rev.
  rev ? null,
  # Overridable parameters
  extraPythonPackages ? [ ],
  extraDependencyGroups ? [ ],
}:
let
  nodejs = nodejs_22;
  mkMaliangVenv =
    extraDependencyGroups:
    callPackage ./python.nix {
      inherit uv2nix pyproject-nix pyproject-build-systems;
      pythonSrc = maliangNpmLib.pythonSrc;
      dependency-groups = [ "all" ] ++ extraDependencyGroups;
    };

  maliangVenv = (mkMaliangVenv extraDependencyGroups).venv;

  maliangNpmLib = callPackage ./lib.nix {
    inherit npm-lockfile-fix nodejs;
  };

  maliangTui = callPackage ./tui.nix {
    inherit maliangNpmLib;
  };

  maliangWeb = callPackage ./web.nix {
    inherit maliangNpmLib;
  };

  bundledSkills = lib.cleanSourceWith {
    src = ../skills;
    filter =
      path: _type: !(lib.hasInfix "/index-cache/" path) && !(lib.hasInfix "/__pycache__/" path);
  };

  # Optional skills are NOT in the wheel (pythonSrc excludes them, see
  # lib.nix) — the wrapper exposes them via MALIANG_OPTIONAL_SKILLS, the
  # same mechanism Homebrew packaging uses.
  bundledOptionalSkills = lib.cleanSourceWith {
    src = ../optional-skills;
    filter =
      path: _type: !(lib.hasInfix "/index-cache/" path) && !(lib.hasInfix "/__pycache__/" path);
  };

  # Import bundled plugins (memory, context_engine, platforms/*).  Keeping
  # them out of the Python site-packages keeps import semantics identical
  # to a dev checkout — the loader reads them from MALIANG_BUNDLED_PLUGINS.
  bundledPlugins = lib.cleanSourceWith {
    src = ../plugins;
    filter = path: _type: !(lib.hasInfix "/__pycache__/" path);
  };

  # i18n locale catalogs (locales/*.yaml). Shipped into the store and pointed
  # at by MALIANG_BUNDLED_LOCALES so the wrapped binary always resolves human
  # strings instead of raw i18n keys (#23943 / #27632 / #35374).
  #
  # Defense-in-depth, not load-bearing: the wheel already declares locales/ as
  # setuptools data-files, so uv2nix materializes them into the venv's data
  # scheme and agent/i18n.py resolves them with no env var. The wrapper override
  # pins the store path so a future uv2nix change that drops data-files can't
  # silently ship raw keys via `nix build` (checks don't run on a plain build).
  # The bundled-locales flake check verifies BOTH paths independently.
  #
  # Plain cleanSource (no __pycache__ filter): locales/ is bare *.yaml, never
  # compiled, so it never carries a __pycache__ dir to exclude.
  bundledLocales = lib.cleanSource ../locales;

  runtimeDeps = [
    nodejs
    ripgrep
    git
    openssh
    ffmpeg
    tirith
  ]
  ++ lib.optionals stdenv.isLinux [
    wl-clipboard
    xclip
  ];

  runtimePath = lib.makeBinPath runtimeDeps;

  sitePackagesPath = python312.sitePackages;

  # Walk propagatedBuildInputs to include transitive Python deps in PYTHONPATH.
  # Without this, a plugin listing e.g. requests as a dep would fail at runtime
  # if requests isn't already in the sealed uv2nix venv.
  allExtraPythonPackages = python312.pkgs.requiredPythonModules extraPythonPackages;

  pythonPath = lib.makeSearchPath sitePackagesPath allExtraPythonPackages;

  checkPackageCollisions = ''
    import pathlib, sys, re

    def canonical(name):
        return re.sub(r'[-_.]+', '-', name).lower()

    # Collect core venv package names
    core = set()
    venv_sp = pathlib.Path('${maliangVenv}/${sitePackagesPath}')
    for di in venv_sp.glob('*.dist-info'):
        meta = di / 'METADATA'
        if meta.exists():
            for line in meta.read_text().splitlines():
                if line.startswith('Name:'):
                    core.add(canonical(line.split(':', 1)[1].strip()))
                    break

    # Check each extra package for collisions
    extras_dirs = [${lib.concatMapStringsSep ", " (p: "'${toString p}'") allExtraPythonPackages}]
    for edir in extras_dirs:
        sp = pathlib.Path(edir) / '${sitePackagesPath}'
        if not sp.exists():
            continue
        for di in sp.glob('*.dist-info'):
            meta = di / 'METADATA'
            if not meta.exists():
                continue
            for line in meta.read_text().splitlines():
                if line.startswith('Name:'):
                    pkg = canonical(line.split(':', 1)[1].strip())
                    if pkg in core:
                        print(f'ERROR: plugin package \"{pkg}\" collides with a package in maliang sealed venv', file=sys.stderr)
                        print(f'  from: {di}', file=sys.stderr)
                        print(f'  Remove this dependency from extraPythonPackages.', file=sys.stderr)
                        sys.exit(1)
                    break

    print('No collisions found.')
  '';
in
stdenv.mkDerivation (finalAttrs: {
  pname = "maliang-agent";
  version = (fromTOML (builtins.readFile ../pyproject.toml)).project.version;

  dontUnpack = true;
  dontBuild = true;
  nativeBuildInputs = [ makeWrapper ];

  installPhase = ''
    runHook preInstall

    # Symlinks, not copies: these are all store paths already, and the
    # wrapper env vars just hold paths.  Symlinking keeps this derivation
    # near-instant when only the venv changed, with an identical closure.
    mkdir -p $out/share/maliang-agent $out/bin
    ln -s ${bundledSkills} $out/share/maliang-agent/skills
    ln -s ${bundledOptionalSkills} $out/share/maliang-agent/optional-skills
    ln -s ${bundledPlugins} $out/share/maliang-agent/plugins
    ln -s ${bundledLocales} $out/share/maliang-agent/locales
    ln -s ${maliangWeb} $out/share/maliang-agent/web_dist
    ln -s ${maliangTui}/lib/maliang-tui $out/ui-tui

    ${lib.concatMapStringsSep "\n"
      (name: ''
        makeWrapper ${maliangVenv}/bin/${name} $out/bin/${name} \
          --suffix PATH : "${runtimePath}" \
          --set MALIANG_BUNDLED_SKILLS $out/share/maliang-agent/skills \
          --set MALIANG_OPTIONAL_SKILLS $out/share/maliang-agent/optional-skills \
          --set MALIANG_BUNDLED_PLUGINS $out/share/maliang-agent/plugins \
          --set MALIANG_BUNDLED_LOCALES $out/share/maliang-agent/locales \
          --set MALIANG_WEB_DIST $out/share/maliang-agent/web_dist \
          --set MALIANG_TUI_DIR $out/ui-tui \
          --set MALIANG_PYTHON ${maliangVenv}/bin/python3 \
          --set MALIANG_NODE ${lib.getExe nodejs}${
            # Fold the line continuation INTO the optionalString: a bare
            # `\` on the line above an empty expansion would dangle onto a
            # blank line, ending the makeWrapper command early and running
            # the next flag as its own shell command (`--suffix: command
            # not found`). Only reproduces when rev == null (dirty trees).
            lib.optionalString (rev != null) " \\\n          --set MALIANG_REVISION ${rev}"
          }${
            lib.optionalString (
              extraPythonPackages != [ ]
            ) " \\\n          --suffix PYTHONPATH : \"${pythonPath}\""
          }
      '')
      [
        "maliang"
        "maliang-agent"
        "maliang-acp"
      ]
    }

    ${lib.optionalString (extraPythonPackages != [ ]) ''
      echo "=== Checking for plugin/core package collisions ==="
      ${maliangVenv}/bin/python3 -c "${checkPackageCollisions}"
      echo "=== No collisions ==="
    ''}

    runHook postInstall
  '';

  passthru =
    let
      devPython = (mkMaliangVenv (extraDependencyGroups ++ [ "dev" ])).editableVenv;
    in
    {
      inherit
        maliangTui
        maliangWeb
        maliangNpmLib
        maliangVenv
        ;

      # `maliangDesktop` references `finalAttrs.finalPackage` (this whole
      # derivation, after all overrides are applied) so the desktop wrapper
      # can prepend its `/bin` to PATH.  The desktop's resolver step 4
      # ("existing maliang on PATH") then picks up the fully wrapped
      # `maliang` binary — venv with all deps, bundled skills/plugins,
      # runtime PATH (ripgrep/git/ffmpeg/etc).  No re-implementation
      # of the agent resolution in the desktop wrapper.
      maliangDesktop = callPackage ./desktop.nix {
        inherit maliangNpmLib electron;
        maliangAgent = finalAttrs.finalPackage;
      };

      devShellHook = ''
        export MALIANG_PYTHON=${devPython}/bin/python3
      '';

      devDeps = runtimeDeps ++ [ devPython ];
    };

  meta = with lib; {
    description = "AI agent with advanced tool-calling capabilities";
    homepage = "https://github.com/NousResearch/maliang-agent";
    mainProgram = "maliang";
    license = licenses.mit;
    platforms = platforms.unix;
  };
})
