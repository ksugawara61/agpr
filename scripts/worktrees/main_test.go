package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

type commandCall struct {
	args []string
	dir  string
	name string
}

type commandResponse struct {
	err    error
	output string
}

type fakeRunner struct {
	afterRun  func(call commandCall)
	calls     []commandCall
	responses []commandResponse
}

func (r *fakeRunner) Output(_ context.Context, dir string, name string, args ...string) (string, error) {
	r.calls = append(r.calls, commandCall{args: append([]string{}, args...), dir: dir, name: name})
	return r.shift()
}

func (r *fakeRunner) Run(_ context.Context, dir string, name string, args ...string) error {
	call := commandCall{args: append([]string{}, args...), dir: dir, name: name}
	r.calls = append(r.calls, call)
	_, err := r.shift()
	if err == nil && r.afterRun != nil {
		r.afterRun(call)
	}

	return err
}

func (r *fakeRunner) shift() (string, error) {
	if len(r.responses) == 0 {
		return "", nil
	}

	response := r.responses[0]
	r.responses = r.responses[1:]
	return response.output, response.err
}

type exitError struct {
	code int
}

func (e exitError) Error() string {
	return fmt.Sprintf("exit status %d", e.code)
}

func (e exitError) ExitCode() int {
	return e.code
}

func TestRun(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		args      []string
		wantCode  int
		wantErr   string
		wantOut   string
		wantCalls []commandCall
	}{
		{
			name:     "prints usage when no command is provided",
			args:     []string{},
			wantCode: 1,
			wantErr:  "Usage:",
		},
		{
			name:     "prints usage for help",
			args:     []string{"--help"},
			wantCode: 0,
			wantOut:  "Usage:",
		},
		{
			name:     "rejects unknown command",
			args:     []string{"unknown"},
			wantCode: 1,
			wantErr:  "Unsupported command: unknown",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			var stderr bytes.Buffer
			var stdout bytes.Buffer
			runner := &fakeRunner{}
			app := app{
				cwd:    t.TempDir(),
				err:    &stderr,
				out:    &stdout,
				runner: runner,
			}

			code := app.run(context.Background(), tt.args)

			if code != tt.wantCode {
				t.Fatalf("code = %d, want %d", code, tt.wantCode)
			}
			if !strings.Contains(stderr.String(), tt.wantErr) {
				t.Fatalf("stderr = %q, want to contain %q", stderr.String(), tt.wantErr)
			}
			if !strings.Contains(stdout.String(), tt.wantOut) {
				t.Fatalf("stdout = %q, want to contain %q", stdout.String(), tt.wantOut)
			}
			if tt.wantCalls != nil && !reflect.DeepEqual(runner.calls, tt.wantCalls) {
				t.Fatalf("calls = %#v, want %#v", runner.calls, tt.wantCalls)
			}
		})
	}
}

func TestCreate(t *testing.T) {
	t.Parallel()

	t.Run("creates worktree, copies includes, runs tool, and removes worktree", func(t *testing.T) {
		t.Parallel()

		repoRoot := t.TempDir()
		physicalRepoRoot := evalSymlinks(t, repoRoot)
		worktreeDir := filepath.Join(repoRoot, ".worktrees", "codex", "feature")
		physicalWorktreeDir := filepath.Join(physicalRepoRoot, ".worktrees", "codex", "feature")
		gitDir := filepath.Join(repoRoot, ".git", "worktrees", "feature")
		gitCommonDir := filepath.Join(repoRoot, ".git")
		writeFile(t, filepath.Join(repoRoot, ".worktreeinclude"), strings.Join([]string{
			"",
			"# comment",
			"config.json\r",
			"nested",
			"missing.txt",
			"../outside",
		}, "\n"))
		writeFile(t, filepath.Join(repoRoot, "config.json"), "config")
		writeFile(t, filepath.Join(repoRoot, "nested", "child.txt"), "child")
		mustMkdir(t, gitDir)
		mustMkdir(t, gitCommonDir)

		sawCopiedIncludes := false
		runner := &fakeRunner{
			afterRun: func(call commandCall) {
				if call.name != "git" || !reflect.DeepEqual(call.args, []string{"worktree", "remove", "."}) {
					return
				}

				if got := readFile(t, filepath.Join(worktreeDir, "config.json")); got != "config" {
					t.Fatalf("copied config = %q, want %q", got, "config")
				}
				if got := readFile(t, filepath.Join(worktreeDir, "nested", "child.txt")); got != "child" {
					t.Fatalf("copied child = %q, want %q", got, "child")
				}
				sawCopiedIncludes = true
				if err := os.RemoveAll(physicalWorktreeDir); err != nil {
					t.Fatal(err)
				}
			},
			responses: []commandResponse{
				{output: repoRoot},
				{},
				{},
				{},
				{},
				{output: worktreeDir},
				{output: gitDir},
				{output: gitCommonDir},
				{},
			},
		}
		var stderr bytes.Buffer
		var stdout bytes.Buffer
		app := app{
			cwd:    repoRoot,
			err:    &stderr,
			out:    &stdout,
			runner: runner,
		}

		status, err := app.create(context.Background(), "codex", "feature", []string{"--ask"})

		if err != nil {
			t.Fatalf("create returned error: %v", err)
		}
		if status != 0 {
			t.Fatalf("status = %d, want 0", status)
		}

		wantCalls := []commandCall{
			{dir: repoRoot, name: "git", args: []string{"rev-parse", "--show-toplevel"}},
			{dir: repoRoot, name: "git", args: []string{"check-ref-format", "--branch", "codex/feature"}},
			{dir: repoRoot, name: "git", args: []string{"-C", repoRoot, "worktree", "add", "-b", "codex/feature", worktreeDir}},
			{dir: worktreeDir, name: "pnpm", args: []string{"install"}},
			{dir: worktreeDir, name: "codex", args: []string{"--sandbox", "workspace-write", "--add-dir", worktreeDir, "--ask"}},
			{dir: worktreeDir, name: "git", args: []string{"rev-parse", "--show-toplevel"}},
			{dir: worktreeDir, name: "git", args: []string{"rev-parse", "--path-format=absolute", "--git-dir"}},
			{dir: worktreeDir, name: "git", args: []string{"rev-parse", "--path-format=absolute", "--git-common-dir"}},
			{dir: physicalWorktreeDir, name: "git", args: []string{"worktree", "remove", "."}},
		}
		if !reflect.DeepEqual(runner.calls, wantCalls) {
			t.Fatalf("calls = %#v, want %#v", runner.calls, wantCalls)
		}

		if !sawCopiedIncludes {
			t.Fatal("expected copied includes to be verified before remove")
		}
		if !strings.Contains(stderr.String(), "Skipping missing .worktreeinclude path: missing.txt") {
			t.Fatalf("stderr = %q, want missing path warning", stderr.String())
		}
		if !strings.Contains(stderr.String(), "Skipping invalid .worktreeinclude path: ../outside") {
			t.Fatalf("stderr = %q, want invalid path warning", stderr.String())
		}
		if !strings.Contains(stdout.String(), "Removed worktree: "+physicalWorktreeDir) {
			t.Fatalf("stdout = %q, want remove message", stdout.String())
		}
	})

	t.Run("returns tool exit code before remove exit code", func(t *testing.T) {
		t.Parallel()

		repoRoot := t.TempDir()
		worktreeDir := filepath.Join(repoRoot, ".worktrees", "copilot", "feature")
		gitDir := filepath.Join(repoRoot, ".git", "worktrees", "feature")
		gitCommonDir := filepath.Join(repoRoot, ".git")
		writeFile(t, filepath.Join(repoRoot, ".worktreeinclude"), "config.json\n")
		writeFile(t, filepath.Join(repoRoot, "config.json"), "config")
		mustMkdir(t, gitDir)
		mustMkdir(t, gitCommonDir)

		runner := &fakeRunner{
			responses: []commandResponse{
				{output: repoRoot},
				{},
				{},
				{},
				{err: exitError{code: 7}},
				{output: worktreeDir},
				{output: gitDir},
				{output: gitCommonDir},
				{err: exitError{code: 9}},
			},
		}
		var stderr bytes.Buffer
		app := app{
			cwd:    repoRoot,
			err:    &stderr,
			out:    ioDiscard{},
			runner: runner,
		}

		status, err := app.create(context.Background(), "copilot", "feature", nil)

		if err != nil {
			t.Fatalf("create returned error: %v", err)
		}
		if status != 7 {
			t.Fatalf("status = %d, want 7", status)
		}
		if !strings.Contains(stderr.String(), "exit status 9") {
			t.Fatalf("stderr = %q, want remove error", stderr.String())
		}
	})
}

func TestRunCreate(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		args     []string
		wantCode int
		wantErr  string
		wantOut  string
	}{
		{
			name:     "prints usage when arguments are missing",
			args:     []string{},
			wantCode: 1,
			wantErr:  "Usage:",
		},
		{
			name:     "prints help",
			args:     []string{"--help"},
			wantCode: 0,
			wantOut:  "Usage:",
		},
		{
			name:     "rejects unsupported tool",
			args:     []string{"vim", "feature"},
			wantCode: 1,
			wantErr:  "Unsupported tool: vim",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			var stderr bytes.Buffer
			var stdout bytes.Buffer
			app := app{
				cwd:    t.TempDir(),
				err:    &stderr,
				out:    &stdout,
				runner: &fakeRunner{},
			}

			code := app.runCreate(context.Background(), tt.args)

			if code != tt.wantCode {
				t.Fatalf("code = %d, want %d", code, tt.wantCode)
			}
			if !strings.Contains(stderr.String(), tt.wantErr) {
				t.Fatalf("stderr = %q, want to contain %q", stderr.String(), tt.wantErr)
			}
			if !strings.Contains(stdout.String(), tt.wantOut) {
				t.Fatalf("stdout = %q, want to contain %q", stdout.String(), tt.wantOut)
			}
		})
	}
}

func TestRemove(t *testing.T) {
	t.Parallel()

	t.Run("rejects main worktree", func(t *testing.T) {
		t.Parallel()

		repoRoot := t.TempDir()
		gitDir := filepath.Join(repoRoot, ".git")
		mustMkdir(t, gitDir)
		app := app{
			cwd: repoRoot,
			err: ioDiscard{},
			out: ioDiscard{},
			runner: &fakeRunner{
				responses: []commandResponse{
					{output: repoRoot},
					{output: gitDir},
					{output: gitDir},
				},
			},
		}

		err := app.remove(context.Background(), "codex", repoRoot)

		if err == nil || !strings.Contains(err.Error(), "Not in a linked worktree") {
			t.Fatalf("err = %v, want main worktree refusal", err)
		}
	})

	t.Run("rejects linked worktree outside tool directory", func(t *testing.T) {
		t.Parallel()

		repoRoot := t.TempDir()
		worktreeRoot := filepath.Join(repoRoot, ".worktrees", "copilot", "feature")
		gitDir := filepath.Join(repoRoot, ".git", "worktrees", "feature")
		gitCommonDir := filepath.Join(repoRoot, ".git")
		mustMkdir(t, worktreeRoot)
		mustMkdir(t, gitDir)
		mustMkdir(t, gitCommonDir)
		app := app{
			cwd: worktreeRoot,
			err: ioDiscard{},
			out: ioDiscard{},
			runner: &fakeRunner{
				responses: []commandResponse{
					{output: worktreeRoot},
					{output: gitDir},
					{output: gitCommonDir},
				},
			},
		}

		err := app.remove(context.Background(), "codex", worktreeRoot)

		if err == nil || !strings.Contains(err.Error(), "not under a .worktrees/codex directory") {
			t.Fatalf("err = %v, want tool directory refusal", err)
		}
	})

	t.Run("removes linked worktree and reports project root", func(t *testing.T) {
		t.Parallel()

		repoRoot := t.TempDir()
		worktreeRoot := filepath.Join(repoRoot, ".worktrees", "codex", "feature")
		physicalRepoRoot := evalSymlinks(t, repoRoot)
		physicalWorktreeRoot := filepath.Join(physicalRepoRoot, ".worktrees", "codex", "feature")
		gitDir := filepath.Join(repoRoot, ".git", "worktrees", "feature")
		gitCommonDir := filepath.Join(repoRoot, ".git")
		mustMkdir(t, worktreeRoot)
		mustMkdir(t, gitDir)
		mustMkdir(t, gitCommonDir)
		runner := &fakeRunner{
			afterRun: removeWorktreeDirOnGitRemove(t, physicalWorktreeRoot),
			responses: []commandResponse{
				{output: worktreeRoot},
				{output: gitDir},
				{output: gitCommonDir},
				{},
			},
		}
		var stdout bytes.Buffer
		app := app{
			cwd:    worktreeRoot,
			err:    ioDiscard{},
			out:    &stdout,
			runner: runner,
		}

		err := app.remove(context.Background(), "codex", worktreeRoot)

		if err != nil {
			t.Fatalf("remove returned error: %v", err)
		}
		if !strings.Contains(stdout.String(), "Project root: "+physicalRepoRoot) {
			t.Fatalf("stdout = %q, want project root", stdout.String())
		}
		wantCall := commandCall{dir: physicalWorktreeRoot, name: "git", args: []string{"worktree", "remove", "."}}
		if !reflect.DeepEqual(runner.calls[len(runner.calls)-1], wantCall) {
			t.Fatalf("last call = %#v, want %#v", runner.calls[len(runner.calls)-1], wantCall)
		}
	})
}

func TestRunRemove(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		args     []string
		wantCode int
		wantErr  string
		wantOut  string
	}{
		{
			name:     "prints usage when arguments are missing",
			args:     []string{},
			wantCode: 1,
			wantErr:  "Usage:",
		},
		{
			name:     "prints help",
			args:     []string{"--help"},
			wantCode: 0,
			wantOut:  "Usage:",
		},
		{
			name:     "rejects unsupported tool",
			args:     []string{"vim"},
			wantCode: 1,
			wantErr:  "Unsupported tool: vim",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			var stderr bytes.Buffer
			var stdout bytes.Buffer
			app := app{
				cwd:    t.TempDir(),
				err:    &stderr,
				out:    &stdout,
				runner: &fakeRunner{},
			}

			code := app.runRemove(context.Background(), tt.args)

			if code != tt.wantCode {
				t.Fatalf("code = %d, want %d", code, tt.wantCode)
			}
			if !strings.Contains(stderr.String(), tt.wantErr) {
				t.Fatalf("stderr = %q, want to contain %q", stderr.String(), tt.wantErr)
			}
			if !strings.Contains(stdout.String(), tt.wantOut) {
				t.Fatalf("stdout = %q, want to contain %q", stdout.String(), tt.wantOut)
			}
		})
	}
}

func TestCleanIncludePath(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		path     string
		wantOK   bool
		wantPath string
	}{
		{name: "keeps relative path", path: ".claude/settings.local.json", wantOK: true, wantPath: ".claude/settings.local.json"},
		{name: "cleans current directory prefix", path: "./config.json", wantOK: true, wantPath: "config.json"},
		{name: "rejects current directory", path: ".", wantOK: false},
		{name: "rejects parent directory", path: "..", wantOK: false},
		{name: "rejects parent traversal", path: "../outside", wantOK: false},
		{name: "rejects absolute path", path: string(filepath.Separator) + "tmp", wantOK: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			gotPath, gotOK := cleanIncludePath(tt.path)

			if gotOK != tt.wantOK {
				t.Fatalf("ok = %t, want %t", gotOK, tt.wantOK)
			}
			if gotPath != tt.wantPath {
				t.Fatalf("path = %q, want %q", gotPath, tt.wantPath)
			}
		})
	}
}

func TestCopyPath(t *testing.T) {
	t.Parallel()

	t.Run("copies file and preserves mode", func(t *testing.T) {
		t.Parallel()

		tmpDir := t.TempDir()
		source := filepath.Join(tmpDir, "source.txt")
		target := filepath.Join(tmpDir, "target.txt")
		writeFile(t, source, "source")
		if err := os.Chmod(source, 0o744); err != nil {
			t.Fatal(err)
		}

		if err := copyPath(source, target); err != nil {
			t.Fatalf("copyPath returned error: %v", err)
		}

		if got := readFile(t, target); got != "source" {
			t.Fatalf("target content = %q, want %q", got, "source")
		}
		info, err := os.Stat(target)
		if err != nil {
			t.Fatal(err)
		}
		if got := info.Mode().Perm(); got != 0o744 {
			t.Fatalf("target mode = %v, want %v", got, os.FileMode(0o744))
		}
	})

	t.Run("copies directory contents", func(t *testing.T) {
		t.Parallel()

		tmpDir := t.TempDir()
		source := filepath.Join(tmpDir, "source")
		target := filepath.Join(tmpDir, "target")
		writeFile(t, filepath.Join(source, "child", "file.txt"), "content")

		if err := copyPath(source, target); err != nil {
			t.Fatalf("copyPath returned error: %v", err)
		}

		if got := readFile(t, filepath.Join(target, "child", "file.txt")); got != "content" {
			t.Fatalf("target content = %q, want %q", got, "content")
		}
	})
}

func TestCommandExitCode(t *testing.T) {
	t.Parallel()

	tests := []struct {
		err  error
		name string
		want int
	}{
		{name: "nil", err: nil, want: 0},
		{name: "exit coder", err: exitError{code: 42}, want: 42},
		{name: "plain error", err: errors.New("failed"), want: 1},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			if got := commandExitCode(tt.err); got != tt.want {
				t.Fatalf("code = %d, want %d", got, tt.want)
			}
		})
	}
}

type ioDiscard struct{}

func (ioDiscard) Write(p []byte) (int, error) {
	return len(p), nil
}

func mustMkdir(t *testing.T, path string) {
	t.Helper()

	if err := os.MkdirAll(path, 0o755); err != nil {
		t.Fatal(err)
	}
}

func writeFile(t *testing.T, path string, content string) {
	t.Helper()

	mustMkdir(t, filepath.Dir(path))
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func readFile(t *testing.T, path string) string {
	t.Helper()

	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}

	return string(content)
}

func evalSymlinks(t *testing.T, path string) string {
	t.Helper()

	physicalPath, err := filepath.EvalSymlinks(path)
	if err != nil {
		t.Fatal(err)
	}

	return physicalPath
}

func removeWorktreeDirOnGitRemove(t *testing.T, worktreeDir string) func(call commandCall) {
	t.Helper()

	return func(call commandCall) {
		if call.name != "git" || !reflect.DeepEqual(call.args, []string{"worktree", "remove", "."}) {
			return
		}

		if err := os.RemoveAll(worktreeDir); err != nil {
			t.Fatal(err)
		}
	}
}
