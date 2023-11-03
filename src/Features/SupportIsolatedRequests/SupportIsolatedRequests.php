<?php

namespace Livewire\Features\SupportIsolatedRequests;

use function Livewire\{ store };
use Livewire\ComponentHook;

class SupportIsolatedRequests extends ComponentHook
{
    public function mount($params)
    {
        if ($params['isolate'] ?? false) {
            store($this->component)->set('isIsolated', true);
        }
    }

    function hydrate($memo)
    {
        if ($memo['isolate'] ?? false) {
            store($this->component)->set('isIsolated', true);
        }
    }

    function dehydrate($context)
    {
        if (store($this->component)->get('isIsolated') === true) {
            $context->addMemo('isolate', true);
        }
    }
}
