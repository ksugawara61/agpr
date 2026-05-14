package main

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

const (
	toolCodex   = "codex"
	toolCopilot = "copilot"
)

type commandRunner interface {
	Output(ctx context.Context, dir string, name string, args ...string) (string, error)
	Run(ctx context.Context, dir string, name string, args ...string) error
}

type osRunner struct {
	stderr io.Writer
	stdin  io.Reader
	stdout io.Writer
}

func (r osRunner) Output(ctx context.Context, dir string, name string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Dir = dir
	cmd.Stderr = r.stderr

	output, err := cmd.Output()
	if err != nil {
		return "", err
	}

	return strings.TrimRight(string(output), "\r\n"), nil
}

func (r osRunner) Run(ctx context.Context, dir string, name string, args ...string) error {
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Dir = dir
	cmd.Stderr = r.stderr
	cmd.Stdin = r.stdin
	cmd.Stdout = r.stdout

	return cmd.Run()
}

type app struct {
	cwd    string
	err    io.Writer
	out    io.Writer
	runner commandRunner
}

func main() {
	cwd, err := os.Getwd()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}

	code := app{
		cwd: cwd,
		err: os.Stderr,
		out: os.Stdout,
		runner: osRunner{
			stderr: os.Stderr,
			stdin:  os.Stdin,
			stdout: os.Stdout,
		},
	}.run(context.Background(), os.Args[1:])

	os.Exit(code)
}

func (a app) run(ctx context.Context, args []string) int {
	if len(args) == 0 {
		a.printUsage(a.err)
		return 1
	}

	switch args[0] {
	case "-h", "--help":
		a.printUsage(a.out)
		return 0
	case "create":
		return a.runCreate(ctx, args[1:])
	case "remove":
		return a.runRemove(ctx, args[1:])
	default:
		fmt.Fprintf(a.err, "Unsupported command: %s\n", args[0])
		fmt.Fprintln(a.err, "Expected one of: create, remove")
		return 1
	}
}

func (a app) printUsage(w io.Writer) {
	fmt.Fprint(w, `Usage:
  go run ./scripts/worktrees create <codex|copilot> <name> [tool-args...]
  go run ./scripts/worktrees remove <codex|copilot>

Creates a git worktree at .worktrees/<tool>/<name>, copies paths
listed in .worktreeinclude, installs dependencies, starts the selected tool,
and removes the worktree after the tool exits.
`)
}

func (a app) runCreate(ctx context.Context, args []string) int {
	if len(args) == 0 {
		printCreateUsage(a.err)
		return 1
	}

	switch args[0] {
	case "-h", "--help":
		printCreateUsage(a.out)
		return 0
	}

	if len(args) < 2 {
		printCreateUsage(a.err)
		return 1
	}

	tool := args[0]
	if !isSupportedTool(tool) {
		printInvalidTool(a.err, tool)
		return 1
	}

	worktreeName := args[1]
	toolArgs := args[2:]

	status, err := a.create(ctx, tool, worktreeName, toolArgs)
	if err != nil {
		fmt.Fprintln(a.err, err)
		return commandExitCode(err)
	}

	return status
}

func printCreateUsage(w io.Writer) {
	fmt.Fprint(w, `Usage: go run ./scripts/worktrees create <codex|copilot> <name> [tool-args...]

Creates a git worktree at .worktrees/<tool>/<name>, copies paths
listed in .worktreeinclude, installs dependencies, starts the selected tool,
and removes the worktree after the tool exits.
`)
}

func (a app) create(ctx context.Context, tool string, worktreeName string, toolArgs []string) (int, error) {
	repoRoot, err := a.runner.Output(ctx, a.cwd, "git", "rev-parse", "--show-toplevel")
	if err != nil {
		return commandExitCode(err), err
	}

	branchName := fmt.Sprintf("%s/%s", tool, worktreeName)
	worktreeDir := filepath.Join(repoRoot, ".worktrees", tool, worktreeName)
	includeFile := filepath.Join(repoRoot, ".worktreeinclude")

	if err := a.runner.Run(ctx, repoRoot, "git", "check-ref-format", "--branch", branchName); err != nil {
		return commandExitCode(err), err
	}

	if exists, err := pathExistsOrSymlink(worktreeDir); err != nil {
		return 1, err
	} else if exists {
		return 1, fmt.Errorf("Worktree path already exists: %s", worktreeDir)
	}

	if err := os.MkdirAll(filepath.Dir(worktreeDir), 0o755); err != nil {
		return 1, err
	}

	if err := a.runner.Run(ctx, repoRoot, "git", "-C", repoRoot, "worktree", "add", "-b", branchName, worktreeDir); err != nil {
		return commandExitCode(err), err
	}

	if err := a.copyIncludedPaths(includeFile, repoRoot, worktreeDir); err != nil {
		return 1, err
	}

	if err := a.runner.Run(ctx, worktreeDir, "pnpm", "install"); err != nil {
		return commandExitCode(err), err
	}

	toolStatus := 0
	if err := a.runTool(ctx, tool, worktreeDir, toolArgs); err != nil {
		toolStatus = commandExitCode(err)
	}

	removeStatus := 0
	if err := a.remove(ctx, tool, worktreeDir); err != nil {
		removeStatus = commandExitCode(err)
		fmt.Fprintln(a.err, err)
	}

	if toolStatus != 0 {
		return toolStatus, nil
	}

	return removeStatus, nil
}

func (a app) copyIncludedPaths(includeFile string, repoRoot string, worktreeDir string) error {
	file, err := os.Open(includeFile)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		includePath := strings.TrimSuffix(scanner.Text(), "\r")
		if includePath == "" || strings.HasPrefix(includePath, "#") {
			continue
		}

		cleanPath, ok := cleanIncludePath(includePath)
		if !ok {
			fmt.Fprintf(a.err, "Skipping invalid .worktreeinclude path: %s\n", includePath)
			continue
		}

		sourcePath := filepath.Join(repoRoot, cleanPath)
		targetPath := filepath.Join(worktreeDir, cleanPath)

		exists, err := pathExistsOrSymlink(sourcePath)
		if err != nil {
			return err
		}
		if !exists {
			fmt.Fprintf(a.err, "Skipping missing .worktreeinclude path: %s\n", includePath)
			continue
		}

		if err := os.MkdirAll(filepath.Dir(targetPath), 0o755); err != nil {
			return err
		}

		if err := copyPath(sourcePath, targetPath); err != nil {
			return err
		}
	}

	return scanner.Err()
}

func cleanIncludePath(path string) (string, bool) {
	cleanPath := filepath.Clean(path)
	if cleanPath == "." || filepath.IsAbs(cleanPath) {
		return "", false
	}
	if cleanPath == ".." || strings.HasPrefix(cleanPath, ".."+string(filepath.Separator)) {
		return "", false
	}

	return cleanPath, true
}

func (a app) runTool(ctx context.Context, tool string, worktreeDir string, toolArgs []string) error {
	switch tool {
	case toolCodex:
		args := append([]string{"--sandbox", "workspace-write", "--add-dir", worktreeDir}, toolArgs...)
		return a.runner.Run(ctx, worktreeDir, "codex", args...)
	case toolCopilot:
		args := append([]string{"--add-dir", worktreeDir}, toolArgs...)
		return a.runner.Run(ctx, worktreeDir, "copilot", args...)
	default:
		return fmt.Errorf("Unsupported tool: %s", tool)
	}
}

func (a app) runRemove(ctx context.Context, args []string) int {
	if len(args) == 0 {
		printRemoveUsage(a.err)
		return 1
	}

	switch args[0] {
	case "-h", "--help":
		printRemoveUsage(a.out)
		return 0
	}

	if len(args) != 1 {
		printRemoveUsage(a.err)
		return 1
	}

	tool := args[0]
	if !isSupportedTool(tool) {
		printInvalidTool(a.err, tool)
		return 1
	}

	if err := a.remove(ctx, tool, a.cwd); err != nil {
		fmt.Fprintln(a.err, err)
		return commandExitCode(err)
	}

	return 0
}

func printRemoveUsage(w io.Writer) {
	fmt.Fprint(w, `Usage: go run ./scripts/worktrees remove <codex|copilot>

Removes the current linked worktree when it lives under
.worktrees/<tool>/<name>, then reports the project root.
`)
}

func (a app) remove(ctx context.Context, tool string, startDir string) error {
	worktreeRoot, err := a.runner.Output(ctx, startDir, "git", "rev-parse", "--show-toplevel")
	if err != nil {
		return err
	}

	gitDir, err := a.runner.Output(ctx, startDir, "git", "rev-parse", "--path-format=absolute", "--git-dir")
	if err != nil {
		return err
	}

	gitCommonDir, err := a.runner.Output(ctx, startDir, "git", "rev-parse", "--path-format=absolute", "--git-common-dir")
	if err != nil {
		return err
	}

	gitDir, err = physicalPath(gitDir)
	if err != nil {
		return err
	}

	gitCommonDir, err = physicalPath(gitCommonDir)
	if err != nil {
		return err
	}

	if gitDir == gitCommonDir {
		return errors.New("Not in a linked worktree. Refusing to remove the main worktree.")
	}

	worktreeRoot, err = physicalPath(worktreeRoot)
	if err != nil {
		return err
	}

	projectRoot, ok := inferProjectRoot(worktreeRoot, tool)
	if !ok {
		return fmt.Errorf("Current linked worktree is not under a .worktrees/%s directory.\nCurrent worktree: %s", tool, worktreeRoot)
	}
	if projectRoot == "" {
		return fmt.Errorf("Cannot infer project root from worktree path: %s", worktreeRoot)
	}

	if exists, err := directoryExists(projectRoot); err != nil {
		return err
	} else if !exists {
		return fmt.Errorf("Cannot infer project root from worktree path: %s", worktreeRoot)
	}

	if err := a.runner.Run(ctx, worktreeRoot, "git", "worktree", "remove", "."); err != nil {
		return err
	}

	if exists, err := directoryExists(worktreeRoot); err != nil {
		return err
	} else if exists {
		if err := os.Remove(worktreeRoot); err != nil {
			return fmt.Errorf("Worktree directory still exists and is not empty: %s", worktreeRoot)
		}
	}

	fmt.Fprintf(a.out, "Removed worktree: %s\n", worktreeRoot)
	fmt.Fprintf(a.out, "Project root: %s\n", projectRoot)

	return nil
}

func inferProjectRoot(worktreeRoot string, tool string) (string, bool) {
	marker := string(filepath.Separator) + filepath.Join(".worktrees", tool) + string(filepath.Separator)
	index := strings.LastIndex(worktreeRoot, marker)
	if index == -1 {
		return "", false
	}

	return worktreeRoot[:index], true
}

func printInvalidTool(w io.Writer, tool string) {
	fmt.Fprintf(w, "Unsupported tool: %s\n", tool)
	fmt.Fprintln(w, "Expected one of: codex, copilot")
}

func isSupportedTool(tool string) bool {
	return tool == toolCodex || tool == toolCopilot
}

func pathExistsOrSymlink(path string) (bool, error) {
	_, err := os.Lstat(path)
	if err == nil {
		return true, nil
	}
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}

	return false, err
}

func directoryExists(path string) (bool, error) {
	info, err := os.Stat(path)
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}

	return info.IsDir(), nil
}

func physicalPath(path string) (string, error) {
	return filepath.EvalSymlinks(path)
}

func copyPath(sourcePath string, targetPath string) error {
	info, err := os.Lstat(sourcePath)
	if err != nil {
		return err
	}

	if info.Mode()&os.ModeSymlink != 0 {
		return copySymlink(sourcePath, targetPath)
	}

	if info.IsDir() {
		return copyDirectory(sourcePath, targetPath, info)
	}

	return copyFile(sourcePath, targetPath, info)
}

func copyDirectory(sourcePath string, targetPath string, rootInfo fs.FileInfo) error {
	if err := os.MkdirAll(targetPath, rootInfo.Mode().Perm()); err != nil {
		return err
	}

	return filepath.WalkDir(sourcePath, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}

		relativePath, err := filepath.Rel(sourcePath, path)
		if err != nil {
			return err
		}
		if relativePath == "." {
			return nil
		}

		target := filepath.Join(targetPath, relativePath)
		info, err := os.Lstat(path)
		if err != nil {
			return err
		}

		if info.Mode()&os.ModeSymlink != 0 {
			return copySymlink(path, target)
		}

		if entry.IsDir() {
			return os.MkdirAll(target, info.Mode().Perm())
		}

		return copyFile(path, target, info)
	})
}

func copySymlink(sourcePath string, targetPath string) error {
	linkTarget, err := os.Readlink(sourcePath)
	if err != nil {
		return err
	}

	if err := os.Remove(targetPath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}

	return os.Symlink(linkTarget, targetPath)
}

func copyFile(sourcePath string, targetPath string, info fs.FileInfo) error {
	source, err := os.Open(sourcePath)
	if err != nil {
		return err
	}
	defer source.Close()

	target, err := os.OpenFile(targetPath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, info.Mode().Perm())
	if err != nil {
		return err
	}

	if _, err := io.Copy(target, source); err != nil {
		target.Close()
		return err
	}

	if err := target.Close(); err != nil {
		return err
	}

	modTime := info.ModTime()
	return os.Chtimes(targetPath, time.Now(), modTime)
}

type exitCoder interface {
	ExitCode() int
}

func commandExitCode(err error) int {
	if err == nil {
		return 0
	}

	var coder exitCoder
	if errors.As(err, &coder) {
		code := coder.ExitCode()
		if code >= 0 {
			return code
		}
	}

	return 1
}
