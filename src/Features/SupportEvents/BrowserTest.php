<?php

namespace Livewire\Features\SupportEvents;

use Illuminate\Support\Facades\Blade;
use Livewire\Attributes\Renderless;
use Tests\BrowserTestCase;
use Livewire\Component;
use Livewire\Livewire;

class BrowserTest extends BrowserTestCase
{
    /** @test */
    public function can_listen_for_component_event_with_this_on_in_javascript()
    {
        Livewire::visit(new class extends Component {
            function foo() {
                $this->dispatch('foo');
            }

            function render()
            {
                return <<<'HTML'
                <div>
                    <button wire:click="foo" dusk="button">Dispatch "foo"</button>

                    <span x-init="@this.on('foo', () => { $el.textContent = 'bar' })" dusk="target" wire:ignore></span>
                </div>
                HTML;
            }
        })
        ->assertDontSeeIn('@target', 'bar')
        ->waitForLivewire()->click('@button')
        ->assertSeeIn('@target', 'bar');
    }

    /** @test */
    public function dont_call_render_on_renderless_event_handler()
    {
        Livewire::visit(new class extends Component {
            public $count = 0;

            protected $listeners = ['foo' => 'onFoo'];

            #[Renderless]
            function onFoo() { }

            function render()
            {
                $this->count++;

                return Blade::render(<<<'HTML'
                <div>
                    <button @click="$dispatch('foo')" dusk="button">{{ $count }}</button>
                </div>
                HTML, ['count' => $this->count]);
            }
        })
            ->assertSeeIn('@button', '1')
            ->waitForLivewire()->click('@button')
            ->assertSeeIn('@button', '1');
    }

    /** @test */
    public function dispatch_from_javascript_should_only_be_called_once()
    {
        Livewire::visit(new class extends Component {
            public $count = 0;

            protected $listeners = ['foo' => 'onFoo'];

            function onFoo()
            {
                $this->count++;
            }

            function render()
            {
                return Blade::render(<<<'HTML'
                <div>
                    <button @click="$dispatch('foo')" dusk="button">{{ $count }}</button>
                </div>
                HTML, ['count' => $this->count]);
            }
        })
            ->assertSeeIn('@button', '0')
            ->waitForLivewire()->click('@button')
            ->assertSeeIn('@button', '1');
    }

    /** @test */
    public function can_dispatch_to_another_component_globally()
    {
        Livewire::visit([
            new class extends Component {
                public function dispatchToOtherComponent()
                {
                    $this->dispatch('foo', message: 'baz')->to('child');
                }

                function render()
                {
                    return <<<'HTML'
                    <div>
                        <button x-on:click="window.Livewire.dispatchTo('child', 'foo', { message: 'bar' })" dusk="button">Dispatch to child from Alpine</button>
                        <button wire:click="dispatchToOtherComponent" dusk="button2">Dispatch to child from Livewire</button>

                        <livewire:child />
                    </div>
                    HTML;
                }
            },
            'child' => new class extends Component {
                public $message = 'foo';

                protected $listeners = ['foo' => 'onFoo'];

                function onFoo($message)
                {
                    $this->message = $message;
                }

                function render()
                {
                    return <<<'HTML'
                    <div>
                        <h1 dusk="output">{{ $message }}</h1>
                    </div>
                    HTML;
                }
            },
        ])
            ->assertSeeIn('@output', 'foo')
            ->waitForLivewire()->click('@button')
            ->waitForTextIn('@output', 'bar')
            // For some reason this is flaky?
            // ->waitForLivewire()->click('@button2')
            // ->waitForTextIn('@output', 'baz')
            ;
    }

    /** @test */
    public function can_unregister_global_livewire_listener()
    {
        Livewire::visit(new class extends Component {
            function render()
            {
                return Blade::render(<<<'HTML'
                <div x-data="{
                    count: 0,
                    listener: null,
                    init() {
                        this.listener = Livewire.on('foo', () => { this.count++ })
                    },
                    removeListener() {
                        this.listener()
                    }
                }">
                    <span x-text="count" dusk="text"></span>
                    <button @click="Livewire.dispatch('foo')" dusk="dispatch">Dispatch Event</button>
                    <button @click="removeListener" dusk="removeListener">Remove Listener</button>
                </div>
                HTML);
            }
        })
            ->assertSeeIn('@text', '0')
            ->click('@dispatch')
            ->assertSeeIn('@text', '1')
            ->click('@removeListener')
            ->click('@dispatch')
            ->assertSeeIn('@text', '1')
        ;
    }
}
