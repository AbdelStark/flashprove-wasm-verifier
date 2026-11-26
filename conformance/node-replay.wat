(module
  (import "fpv_port" "abi_version" (func $version (result i32)))
  (import "fpv_port" "pipe" (func $pipe (param i32) (result i32)))
  (import "fpv_port" "fork" (func $fork (result i32)))
  (import "fpv_port" "dup2" (func $dup2 (param i32 i32) (result i32)))
  (import "fpv_port" "waitpid" (func $wait (param i32 i32 i32) (result i32)))
  (import "wasi_snapshot_preview1" "path_open" (func $open (param i32 i32 i32 i32 i32 i64 i64 i32 i32) (result i32)))
  (import "wasi_snapshot_preview1" "fd_close" (func $close (param i32) (result i32)))
  (import "wasi_snapshot_preview1" "fd_write" (func $write (param i32 i32 i32 i32) (result i32)))
  (import "wasi_snapshot_preview1" "fd_read" (func $read (param i32 i32 i32 i32) (result i32)))
  (import "wasi_snapshot_preview1" "clock_time_get" (func $time (param i32 i64 i32) (result i32)))
  (import "wasi_snapshot_preview1" "proc_exit" (func $exit (param i32)))
  (memory (export "memory") 1 1)
  (func (export "fpv_set_memory_limit") (param i32) (result i32) i32.const 0)
  (func (export "fpv_memory_failure") (result i32) i32.const 0)
  (data (i32.const 300) "file")
  (data (i32.const 600) "PZabc")
  (func $assert (param i32)
    local.get 0 i32.eqz if unreachable end)
  (func $emit (param $fd i32) (param $byte i32)
    i32.const 100 local.get $byte i32.store
    i32.const 104 i32.const 1 i32.store
    local.get $fd i32.const 100 i32.const 1 i32.const 116 call $write i32.eqz call $assert)
  (func $take (param $fd i32) (param $count i32) (result i32)
    i32.const 100 i32.const 400 i32.store
    i32.const 104 local.get $count i32.store
    local.get $fd i32.const 100 i32.const 1 i32.const 116 call $read i32.eqz call $assert
    i32.const 116 i32.load)
  (func (export "_start") (local $fd i32) (local $i i32) (local $slot i32)
        (local $pid i32) (local $earlier i32) (local $failure i32)
    i32.const 500 i32.load i32.eqz call $assert
    i32.const 500 i32.const 1 i32.store
    call $version i32.const 1 i32.eq call $assert
    i32.const 1 i64.const 1 i32.const 520 call $time i32.eqz call $assert
    i32.const 3 i32.const 0 i32.const 300 i32.const 4 i32.const 0
    i64.const 2 i64.const 0 i32.const 0 i32.const 200 call $open i32.eqz call $assert
    i32.const 200 i32.load local.tee $fd i32.const 1 call $take i32.const 1 i32.eq call $assert
    i32.const 400 i32.load8_u i32.const 84 i32.eq local.set $failure
    local.get $fd call $close i32.eqz call $assert
    i32.const 1 i32.const 600 call $emit

    (loop $stages
      local.get $i i32.const 12 i32.mul local.tee $slot call $pipe i32.eqz call $assert
      call $fork local.tee $pid i32.eqz
      if
        (block $priorDone
          (loop $prior
            local.get $earlier local.get $slot i32.eq br_if $priorDone
            local.get $earlier i32.load call $close i32.eqz call $assert
            local.get $earlier i32.const 12 i32.add local.set $earlier
            br $prior))
        local.get $slot i32.load call $close i32.eqz call $assert
        local.get $slot i32.load offset=4 i32.const 1 call $dup2 i32.const 1 i32.eq call $assert
        local.get $slot i32.load offset=4 call $close i32.eqz call $assert
        i32.const 1 i32.const 602 local.get $i i32.add call $emit
        i32.const 2 i32.const 602 local.get $i i32.add call $emit
        local.get $failure local.get $i i32.const 2 i32.eq i32.and if unreachable end
        i32.const 11 local.get $i i32.add call $exit
        unreachable
      end
      local.get $slot local.get $pid i32.store offset=8
      local.get $slot i32.load offset=4 call $close i32.eqz call $assert
      local.get $i i32.const 1 i32.add local.tee $i i32.const 3 i32.lt_u br_if $stages)

    (loop $drain
      local.get $i i32.const 1 i32.sub local.tee $i i32.const 12 i32.mul local.tee $slot i32.load local.set $fd
      local.get $failure local.get $i i32.const 2 i32.eq i32.and
      if
        local.get $fd i32.const 2 call $take i32.eqz call $assert
      else
        local.get $fd i32.const 2 call $take i32.const 1 i32.eq call $assert
        i32.const 400 i32.load8_u i32.const 97 local.get $i i32.add i32.eq call $assert
      end
      local.get $fd i32.const 1 call $take i32.eqz call $assert
      local.get $fd call $close i32.eqz call $assert
      local.get $slot i32.load offset=8 local.tee $pid
      i32.const 120 i32.const 0 call $wait local.get $pid i32.eq call $assert
      i32.const 120 i32.load
      local.get $failure local.get $i i32.const 2 i32.eq i32.and
      if (result i32) i32.const 6 else i32.const 11 local.get $i i32.add i32.const 8 i32.shl end
      i32.eq call $assert
      local.get $i br_if $drain)
    i32.const 1 i32.const 601 call $emit
    local.get $failure call $exit))
