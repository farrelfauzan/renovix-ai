import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { Access } from '../common/decorators/access.decorator';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @Access({ public: true, reason: 'API greeting, no data behind it' })
  getData() {
    return this.appService.getData();
  }
}
