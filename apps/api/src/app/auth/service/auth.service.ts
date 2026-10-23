import { Injectable } from "@nestjs/common";
import { UserRepository } from "../repository/user.repository";
import { UpdateProfileDto } from "../dto/create-auth.dto";

@Injectable()
export class AuthService {
  constructor(private readonly users: UserRepository) {}

  getProfile(userId: string) {
    return this.users.findProfileOrThrow(userId);
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.users.updateProfile(userId, dto);
    return user;
  }
}
